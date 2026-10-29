package baseten

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Provider is the minimal model interface. Keeps model client separate from proposal validation.
type Provider interface {
	Complete(ctx context.Context, instruction string, selectedObjectID string, beforeWidthMm float64, objectKind, objectName string) (RawResult, error)
	AnalyzePhoto(ctx context.Context, mimeType string, base64Data string, filename string) (RawAnalysis, error)
	ProposeLayout(ctx context.Context, mimeType string, base64Data string, filename string) (RawLayoutDraft, error)
}

// RawAnalysis is the provider's JSON for photo analysis.
type RawAnalysis struct {
	Kind              string   `json:"kind"` // "analysis"
	Description       string   `json:"description"`
	FollowUpQuestions []string `json:"followUpQuestions"`
}

// RawResult is the provider's JSON payload, as parsed from chat completions.
type RawResult struct {
	Kind        string  `json:"kind"` // "proposal" | "clarification"
	ObjectID    string  `json:"objectId,omitempty"`
	AfterMm     float64 `json:"afterMm,omitempty"`
	Explanation string  `json:"explanation,omitempty"`
	Message     string  `json:"message,omitempty"`
}

// RawLayoutDraft is the model's JSON for photo-to-layout. Versioned and limited to workspace-representable fields.
type RawLayoutDraft struct {
	Kind              string              `json:"kind"` // "layout_draft" | "needs_info"
	Version           int                 `json:"version,omitempty"`
	Objects           []RawLayoutObject   `json:"objects,omitempty"`
	Description       string              `json:"description,omitempty"`
	FollowUpQuestions []string            `json:"followUpQuestions,omitempty"`
	Warnings          []string            `json:"warnings,omitempty"`
	IsApproximate     *bool               `json:"isApproximate,omitempty"`
	Message           string              `json:"message,omitempty"`
}

type RawLayoutObject struct {
	Kind            string  `json:"kind"`
	Name            string  `json:"name"`
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	Depth           float64 `json:"depth"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	Z               float64 `json:"z"`
	RotationDegrees float64 `json:"rotationDegrees"`
}

// Client calls Baseten's OpenAI-compatible chat completions.
type Client struct {
	BaseURL  string
	Model    string
	APIKey   string
	HTTP     *http.Client
	Timeout  time.Duration
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []chatMessage   `json:"messages"`
	Temperature    float64         `json:"temperature"`
	MaxTokens      int             `json:"max_tokens"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
}

type responseFormat struct {
	Type string `json:"type"` // "json_object"
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

func New(baseURL, model, apiKey string, timeout time.Duration) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Model:   model,
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: timeout + 2*time.Second},
		Timeout: timeout,
	}
}

func (c *Client) Complete(ctx context.Context, instruction string, selectedObjectID string, beforeWidthMm float64, objectKind, objectName string) (RawResult, error) {
	if c.APIKey == "" {
		return RawResult{}, fmt.Errorf("baseten api key not configured")
	}
	sys := buildSystemPrompt(selectedObjectID, beforeWidthMm, objectKind, objectName)
	user := buildUserPrompt(instruction, selectedObjectID, beforeWidthMm, objectKind, objectName)

	reqBody := chatRequest{
		Model: c.Model,
		Messages: []chatMessage{
			{Role: "system", Content: sys},
			{Role: "user", Content: user},
		},
		Temperature: 0.2,
		MaxTokens:   512,
		ResponseFormat: &responseFormat{Type: "json_object"},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return RawResult{}, err
	}

	// Bound context for provider call.
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return RawResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return RawResult{}, fmt.Errorf("provider timeout: %w", err)
		}
		return RawResult{}, err
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, 64*1024)
	body, err := io.ReadAll(limited)
	if err != nil {
		return RawResult{}, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Do not leak raw provider body verbatim; wrap with code.
		return RawResult{}, fmt.Errorf("provider error %d: %s", resp.StatusCode, truncate(string(body), 500))
	}

	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		return RawResult{}, fmt.Errorf("invalid provider response: %w", err)
	}
	if len(cr.Choices) == 0 {
		return RawResult{}, fmt.Errorf("invalid provider response: no choices")
	}
	content := strings.TrimSpace(cr.Choices[0].Message.Content)
	if content == "" {
		return RawResult{}, fmt.Errorf("invalid provider response: empty content")
	}
	var raw RawResult
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return RawResult{}, fmt.Errorf("invalid provider response: %w body=%s", err, truncate(content, 500))
	}
	return raw, nil
}

func buildSystemPrompt(selectedID string, beforeMm float64, kind, name string) string {
	return fmt.Sprintf(`You are RenovaCAD's cabinet resizing assistant.

Rules:
- Only resize the selected cabinet's width. No other operation.
- Return absolute target width in millimeters (mm). 1 inch = 25.4 mm.
- Example: if cabinet is 36 inches (914.4 mm) and user says "make it 6 inches wider", return 42 inches = 1066.8 mm.
- You must respond with EXACTLY one JSON object, no surrounding text.
- If the instruction is ambiguous, missing amount, or cannot be resolved, return clarification.
- Allowed JSON shapes:
  1) {"kind":"proposal","objectId":"%s","afterMm":<number>,"explanation":"<short explanation with before/after in in and mm>"}
  2) {"kind":"clarification","message":"<question to user>"}
- Do not include code, URLs, or tool calls. objectId must equal "%s" for proposals.
- Current selected object: id=%s, name=%s, kind=%s, width=%.3f mm (%.2f in).
- Valid target width: 25.4 to 10000 mm.`, selectedID, selectedID, selectedID, name, kind, beforeMm, beforeMm/25.4)
}

func buildUserPrompt(instruction, selectedID string, _ float64, _, _ string) string {
	return fmt.Sprintf(`Instruction: %q
Selected object ID: %s

Respond with one JSON object as specified.`, instruction, selectedID)
}

type visionContentPart struct {
	Type     string     `json:"type"`
	Text     string     `json:"text,omitempty"`
	ImageURL *imageURL  `json:"image_url,omitempty"`
}

type imageURL struct {
	URL string `json:"url"`
}

type visionChatMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []visionContentPart
}

type visionChatRequest struct {
	Model          string               `json:"model"`
	Messages       []visionChatMessage  `json:"messages"`
	Temperature    float64              `json:"temperature"`
	MaxTokens      int                  `json:"max_tokens"`
	ResponseFormat *responseFormat      `json:"response_format,omitempty"`
}

func (c *Client) AnalyzePhoto(ctx context.Context, mimeType string, base64Data string, filename string) (RawAnalysis, error) {
	if c.APIKey == "" {
		return RawAnalysis{}, fmt.Errorf("baseten api key not configured")
	}
	sys := `You are RenovaCAD's kitchen photo analyst. You see a kitchen reference photo the user imported.

Rules:
- Describe visible kitchen features concisely: cabinets, countertops, layout, appliances, lighting, materials, colors. Be helpful but do not invent details not visible.
- Do NOT claim accurate measurements or dimensions. State that dimensions cannot be reliably inferred from a photo.
- Do NOT construct or modify the 3D scene. Do not propose object placements.
- Provide 2-4 useful follow-up questions about missing information (measurements, wall lengths, ceiling height, appliance models, desired changes).
- Return EXACTLY one JSON object with shape {"kind":"analysis","description":"...","followUpQuestions":["...","..."]}. No surrounding text.`
	userText := "Analyze this kitchen photo. Provide a concise description and follow-up questions about missing dimensions."
	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
	reqBody := visionChatRequest{
		Model: c.Model,
		Messages: []visionChatMessage{
			{Role: "system", Content: sys},
			{Role: "user", Content: []visionContentPart{
				{Type: "text", Text: userText},
				{Type: "image_url", ImageURL: &imageURL{URL: dataURL}},
			}},
		},
		Temperature: 0.2,
		MaxTokens:   600,
		ResponseFormat: &responseFormat{Type: "json_object"},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return RawAnalysis{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return RawAnalysis{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return RawAnalysis{}, fmt.Errorf("provider timeout: %w", err)
		}
		return RawAnalysis{}, err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, 64*1024)
	body, err := io.ReadAll(limited)
	if err != nil {
		return RawAnalysis{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RawAnalysis{}, fmt.Errorf("provider error %d: %s", resp.StatusCode, truncate(string(body), 500))
	}
	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: %w", err)
	}
	if len(cr.Choices) == 0 {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: no choices")
	}
	content := strings.TrimSpace(cr.Choices[0].Message.Content)
	if content == "" {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: empty content")
	}
	var raw RawAnalysis
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: %w body=%s", err, truncate(content, 500))
	}
	if raw.Kind != "analysis" {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: expected kind analysis got %q", raw.Kind)
	}
	if strings.TrimSpace(raw.Description) == "" {
		return RawAnalysis{}, fmt.Errorf("invalid provider response: empty description")
	}
	return raw, nil
}

func (c *Client) ProposeLayout(ctx context.Context, mimeType string, base64Data string, filename string) (RawLayoutDraft, error) {
	if c.APIKey == "" {
		return RawLayoutDraft{}, fmt.Errorf("baseten api key not configured")
	}
	sys := `You are RenovaCAD's kitchen photo-to-layout assistant. You see a kitchen photo the user wants to turn into an editable draft.

Rules:
- Recognize only these kinds: "base-cabinet" (lower cabinets), "wall-cabinet" (upper cabinets), "tall-cabinet" (pantry), "sink", "wall".
- Propose 1-8 objects that are clearly visible. Use approximate, editable defaults from catalog when measurements unavailable; never claim dimensions are verified or construction-ready.
- Catalog defaults (mm): base-cabinet 914.4×876.3×609.6, wall-cabinet 914.4×762×304.8, tall-cabinet 457.2×2133.6×609.6, wall 3048×2438.4×152.4, sink 762×228.6×508.
- Positions are millimeters: X width (right), Y height (up, 0 floor), Z depth (forward). Place objects along walls with non-overlapping footprints.
- If the image is not a kitchen, is too blurry, empty, or lacks recognizable layout, return needs_info with explanation instead of inventing objects.
- Include 2-4 follow-up questions about missing measurements (wall lengths, ceiling height, appliance details).
- Mark all dimensions as approximate and include warning that photo cannot provide verified measurements.
- Return EXACTLY one JSON object, no surrounding text.
- Allowed shapes:
  1) {"kind":"layout_draft","version":1,"objects":[{"kind":"base-cabinet","name":"Base cabinet 1","width":914.4,"height":876.3,"depth":609.6,"x":0,"y":0,"z":0,"rotationDegrees":0}],"description":"...","followUpQuestions":["..."],"warnings":["Approximate dimensions — please verify"],"isApproximate":true}
  2) {"kind":"needs_info","message":"...","followUpQuestions":["..."]}
- Valid ranges: width/height/depth 25.4-10000 mm, x/y/z -10000 to 10000, rotationDegrees -360 to 360.
- Use version 1. Keep response concise.`

	userText := "Create an editable kitchen draft from this photo. Propose recognizable base cabinets, upper cabinets, tall cabinets, sink, or walls as a reviewable draft with approximate dimensions. Ask for measurements if unavailable."

	dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
	reqBody := visionChatRequest{
		Model: c.Model,
		Messages: []visionChatMessage{
			{Role: "system", Content: sys},
			{Role: "user", Content: []visionContentPart{
				{Type: "text", Text: userText},
				{Type: "image_url", ImageURL: &imageURL{URL: dataURL}},
			}},
		},
		Temperature: 0.2,
		MaxTokens:   1200,
		ResponseFormat: &responseFormat{Type: "json_object"},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return RawLayoutDraft{}, err
	}
	_ = filename // keep for logging without leaking
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return RawLayoutDraft{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return RawLayoutDraft{}, fmt.Errorf("provider timeout: %w", err)
		}
		return RawLayoutDraft{}, err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, 64*1024)
	body, err := io.ReadAll(limited)
	if err != nil {
		return RawLayoutDraft{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Keep body out of logs where possible; truncate and avoid leaking credentials or photo data.
		msg := truncate(string(body), 500)
		switch resp.StatusCode {
		case 401:
			return RawLayoutDraft{}, fmt.Errorf("unauthorized: provider error 401: %s", msg)
		case 403:
			return RawLayoutDraft{}, fmt.Errorf("model_unavailable: provider error 403: %s", msg)
		case 404:
			return RawLayoutDraft{}, fmt.Errorf("model_not_found: provider error 404: %s", msg)
		case 429:
			return RawLayoutDraft{}, fmt.Errorf("rate_limited: provider error 429: %s", msg)
		default:
			return RawLayoutDraft{}, fmt.Errorf("provider error %d: %s", resp.StatusCode, msg)
		}
	}
	var cr chatResponse
	if err := json.Unmarshal(body, &cr); err != nil {
		return RawLayoutDraft{}, fmt.Errorf("invalid provider response: %w", err)
	}
	if len(cr.Choices) == 0 {
		return RawLayoutDraft{}, fmt.Errorf("invalid provider response: no choices")
	}
	content := strings.TrimSpace(cr.Choices[0].Message.Content)
	if content == "" {
		return RawLayoutDraft{}, fmt.Errorf("invalid provider response: empty content")
	}
	var raw RawLayoutDraft
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return RawLayoutDraft{}, fmt.Errorf("invalid provider response: %w body=%s", err, truncate(content, 800))
	}
	if raw.Kind != "layout_draft" && raw.Kind != "needs_info" {
		return RawLayoutDraft{}, fmt.Errorf("invalid provider response: expected kind layout_draft or needs_info got %q", raw.Kind)
	}
	return raw, nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// Fake is a deterministic provider for tests.
type Fake struct {
	Result       RawResult
	Analysis     RawAnalysis
	Layout       RawLayoutDraft
	Err          error
	AnalyzeErr   error
	LayoutErr    error
	// Delay simulates latency; respect ctx.
	Delay time.Duration
}

func (f *Fake) Complete(ctx context.Context, _ string, _ string, _ float64, _ string, _ string) (RawResult, error) {
	if f.Delay > 0 {
		select {
		case <-time.After(f.Delay):
		case <-ctx.Done():
			return RawResult{}, fmt.Errorf("provider timeout: %w", ctx.Err())
		}
	}
	if f.Err != nil {
		return RawResult{}, f.Err
	}
	return f.Result, nil
}

func (f *Fake) AnalyzePhoto(ctx context.Context, _ string, _ string, _ string) (RawAnalysis, error) {
	if f.Delay > 0 {
		select {
		case <-time.After(f.Delay):
		case <-ctx.Done():
			return RawAnalysis{}, fmt.Errorf("provider timeout: %w", ctx.Err())
		}
	}
	if f.AnalyzeErr != nil {
		return RawAnalysis{}, f.AnalyzeErr
	}
	if f.Analysis.Kind != "" {
		return f.Analysis, nil
	}
	// Default canned analysis for tests
	return RawAnalysis{
		Kind:        "analysis",
		Description: "Visible: base cabinets along the wall, light countertop, upper cabinets, window above sink. Materials appear wood with light finish.",
		FollowUpQuestions: []string{
			"What are the wall-to-wall dimensions?",
			"What is the ceiling height and desired cabinet height?",
			"Which appliances should stay or be replaced?",
		},
	}, nil
}

func (f *Fake) ProposeLayout(ctx context.Context, _ string, _ string, _ string) (RawLayoutDraft, error) {
	if f.Delay > 0 {
		select {
		case <-time.After(f.Delay):
		case <-ctx.Done():
			return RawLayoutDraft{}, fmt.Errorf("provider timeout: %w", ctx.Err())
		}
	}
	if f.LayoutErr != nil {
		return RawLayoutDraft{}, f.LayoutErr
	}
	if f.Layout.Kind != "" {
		return f.Layout, nil
	}
	approx := true
	return RawLayoutDraft{
		Kind:    "layout_draft",
		Version: 1,
		Objects: []RawLayoutObject{
			{Kind: "base-cabinet", Name: "Base cabinet 1", Width: 914.4, Height: 876.3, Depth: 609.6, X: -650, Y: 0, Z: -300, RotationDegrees: 0},
			{Kind: "wall-cabinet", Name: "Wall cabinet 1", Width: 914.4, Height: 762, Depth: 304.8, X: -650, Y: 1480, Z: -300, RotationDegrees: 0},
			{Kind: "sink", Name: "Sink", Width: 762, Height: 228.6, Depth: 508, X: 400, Y: 0, Z: -300, RotationDegrees: 0},
		},
		Description:       "Detected base cabinets along the wall, an upper cabinet, and a sink. Positions are approximate along the back wall.",
		FollowUpQuestions: []string{"What is the wall length?", "Confirm sink position and cabinet heights?"},
		Warnings:          []string{"Approximate dimensions — please verify and measure before building."},
		IsApproximate:     &approx,
	}, nil
}
