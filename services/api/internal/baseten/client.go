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
}

// RawResult is the provider's JSON payload, as parsed from chat completions.
type RawResult struct {
	Kind        string  `json:"kind"` // "proposal" | "clarification"
	ObjectID    string  `json:"objectId,omitempty"`
	AfterMm     float64 `json:"afterMm,omitempty"`
	Explanation string  `json:"explanation,omitempty"`
	Message     string  `json:"message,omitempty"`
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

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// Fake is a deterministic provider for tests.
type Fake struct {
	Result RawResult
	Err    error
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
