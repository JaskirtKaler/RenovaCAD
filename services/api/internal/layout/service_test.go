package layout

import (
	"context"
	"fmt"
	"testing"
	"time"

	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/model"
)

func validImage() model.AnalyzeImage {
	return model.AnalyzeImage{
		Name:     "kitchen.png",
		MimeType: "image/png",
		DataURL:  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
	}
}

func TestProposeDraft_Valid(t *testing.T) {
	approx := true
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{
			Kind:    "layout_draft",
			Version: 1,
			Objects: []baseten.RawLayoutObject{
				{Kind: "base-cabinet", Name: "Base 1", Width: 914.4, Height: 876.3, Depth: 609.6, X: 0, Y: 0, Z: 0, RotationDegrees: 0},
				{Kind: "wall-cabinet", Name: "Wall 1", Width: 914.4, Height: 762, Depth: 304.8, X: 0, Y: 1480, Z: 0, RotationDegrees: 0},
			},
			Description:       "Detected cabinets",
			FollowUpQuestions: []string{"Wall length?"},
			Warnings:          []string{"Approximate dimensions — verify"},
			IsApproximate:     &approx,
		},
	}
	svc := &Service{Provider: fake}
	resp, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Kind != "layout_draft" || resp.Draft == nil {
		t.Fatalf("expected layout_draft, got %+v", resp)
	}
	if len(resp.Draft.Objects) != 2 {
		t.Fatalf("expected 2 objects, got %d", len(resp.Draft.Objects))
	}
	if !resp.Draft.IsApproximate {
		t.Fatalf("expected IsApproximate true")
	}
	// Approximate must be clearly marked — warnings must contain approximate
	hasApprox := false
	for _, w := range resp.Draft.Warnings {
		if containsIgnoreCase(w, "approximate") {
			hasApprox = true
			break
		}
	}
	if !hasApprox {
		t.Fatalf("expected warnings to contain approximate, got %v", resp.Draft.Warnings)
	}
	// Check that dimensions cannot be presented as verified — IsApproximate must be true when warnings say approximate
	if !hasApprox && !resp.Draft.IsApproximate {
		t.Fatalf("draft should not be presented as verified")
	}
}

func TestProposeDraft_NeedsInfo(t *testing.T) {
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{
			Kind:              "needs_info",
			Message:           "Photo too blurry",
			FollowUpQuestions: []string{"Provide clearer photo"},
		},
	}
	svc := &Service{Provider: fake}
	resp, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Kind != "needs_info" {
		t.Fatalf("expected needs_info, got %s", resp.Kind)
	}
	if resp.Message == "" {
		t.Fatalf("expected message")
	}
}

func TestProposeDraft_InvalidKind(t *testing.T) {
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{
			Kind:    "layout_draft",
			Version: 1,
			Objects: []baseten.RawLayoutObject{
				{Kind: "sofa", Name: "Sofa", Width: 1000, Height: 800, Depth: 800, X: 0, Y: 0, Z: 0, RotationDegrees: 0},
			},
			Description: "bad",
		},
	}
	svc := &Service{Provider: fake}
	_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "invalid_provider_response" {
		t.Fatalf("expected invalid_provider_response for unsupported kind, got %v", err)
	}
}

func TestProposeDraft_ExcessiveObjects(t *testing.T) {
	objs := make([]baseten.RawLayoutObject, 9)
	for i := range objs {
		objs[i] = baseten.RawLayoutObject{Kind: "base-cabinet", Name: fmt.Sprintf("C%d", i), Width: 900, Height: 800, Depth: 600, X: float64(i * 100), Y: 0, Z: 0}
	}
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{Kind: "layout_draft", Version: 1, Objects: objs},
	}
	svc := &Service{Provider: fake}
	_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "invalid_provider_response" {
		t.Fatalf("expected invalid_provider_response for excessive objects, got %v", err)
	}
}

func TestProposeDraft_InvalidDimensions(t *testing.T) {
	cases := []baseten.RawLayoutObject{
		{Kind: "base-cabinet", Name: "BadW", Width: 10, Height: 800, Depth: 600, X: 0, Y: 0, Z: 0},
		{Kind: "base-cabinet", Name: "BadH", Width: 900, Height: 20000, Depth: 600, X: 0, Y: 0, Z: 0},
		{Kind: "base-cabinet", Name: "BadD", Width: 900, Height: 800, Depth: 0, X: 0, Y: 0, Z: 0},
	}
	for idx, obj := range cases {
		fake := &baseten.Fake{
			Layout: baseten.RawLayoutDraft{Kind: "layout_draft", Version: 1, Objects: []baseten.RawLayoutObject{obj}},
		}
		svc := &Service{Provider: fake}
		_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
		if err == nil || err.Code != "invalid_provider_response" {
			t.Fatalf("case %d expected invalid_provider_response for bad dims, got %v", idx, err)
		}
	}
}

func TestProposeDraft_InvalidPositions(t *testing.T) {
	cases := []baseten.RawLayoutObject{
		{Kind: "base-cabinet", Name: "BadX", Width: 900, Height: 800, Depth: 600, X: 20000, Y: 0, Z: 0},
		{Kind: "base-cabinet", Name: "BadY", Width: 900, Height: 800, Depth: 600, X: 0, Y: 20000, Z: 0},
		{Kind: "wall", Name: "BadZ", Width: 900, Height: 800, Depth: 600, X: 0, Y: 0, Z: -20000},
		{Kind: "base-cabinet", Name: "BadRot", Width: 900, Height: 800, Depth: 600, X: 0, Y: 0, Z: 0, RotationDegrees: 500},
	}
	for idx, obj := range cases {
		fake := &baseten.Fake{
			Layout: baseten.RawLayoutDraft{Kind: "layout_draft", Version: 1, Objects: []baseten.RawLayoutObject{obj}},
		}
		svc := &Service{Provider: fake}
		_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
		if err == nil || err.Code != "invalid_provider_response" {
			t.Fatalf("case %d expected invalid_provider_response for bad pos, got %v", idx, err)
		}
	}
}

func TestProposeDraft_MalformedMissingValues(t *testing.T) {
	// Missing width (zero) should be rejected as out of range
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{
			Kind:    "layout_draft",
			Version: 1,
			Objects: []baseten.RawLayoutObject{
				{Kind: "base-cabinet", Name: "", Width: 0, Height: 0, Depth: 0, X: 0, Y: 0, Z: 0},
			},
		},
	}
	svc := &Service{Provider: fake}
	_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "invalid_provider_response" {
		t.Fatalf("expected error for missing values, got %v", err)
	}
	// Empty objects
	fake2 := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{Kind: "layout_draft", Version: 1, Objects: []baseten.RawLayoutObject{}},
	}
	svc2 := &Service{Provider: fake2}
	_, err2 := svc2.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err2 == nil {
		t.Fatalf("expected error for empty objects")
	}
}

func TestProposeDraft_UnsupportedVersion(t *testing.T) {
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{Kind: "layout_draft", Version: 99, Objects: []baseten.RawLayoutObject{{Kind: "base-cabinet", Name: "C", Width: 900, Height: 800, Depth: 600, X: 0, Y: 0, Z: 0}}},
	}
	svc := &Service{Provider: fake}
	_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "invalid_provider_response" {
		t.Fatalf("expected version error, got %v", err)
	}
}

func TestProposeDraft_Timeout(t *testing.T) {
	fake := &baseten.Fake{Delay: 200 * time.Millisecond}
	svc := &Service{Provider: fake}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := svc.ProposeDraft(ctx, model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "provider_timeout" {
		t.Fatalf("expected provider_timeout, got %v", err)
	}
}

func TestProposeDraft_ProviderError(t *testing.T) {
	fake := &baseten.Fake{LayoutErr: fmt.Errorf("provider error 500: internal")}
	svc := &Service{Provider: fake}
	_, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err == nil || err.Code != "provider_error" {
		t.Fatalf("expected provider_error, got %v", err)
	}
}

func TestProposeDraft_ApproximateCannotBeVerified(t *testing.T) {
	// Even if provider claims isApproximate false, service should ensure warnings still contain approximate and IsApproximate handling
	isApproxFalse := false
	fake := &baseten.Fake{
		Layout: baseten.RawLayoutDraft{
			Kind:        "layout_draft",
			Version:     1,
			Objects:     []baseten.RawLayoutObject{{Kind: "base-cabinet", Name: "C", Width: 900, Height: 800, Depth: 600, X: 0, Y: 0, Z: 0}},
			Description: "test",
			Warnings:    []string{"Some warning without approx"},
			IsApproximate: &isApproxFalse,
		},
	}
	svc := &Service{Provider: fake}
	resp, err := svc.ProposeDraft(context.Background(), model.LayoutDraftRequest{Image: validImage()})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Service should inject approximate warning even if provider says false
	hasApprox := false
	for _, w := range resp.Draft.Warnings {
		if containsIgnoreCase(w, "approximate") {
			hasApprox = true
			break
		}
	}
	if !hasApprox {
		t.Fatalf("expected approximate warning injected, got %v", resp.Draft.Warnings)
	}
	// IsApproximate should reflect provider's claim but UI must still treat as approximate via warnings
	// Ensure we don't present as verified: warnings must say approximate
	if resp.Draft.IsApproximate == false && !hasApprox {
		t.Fatalf("should not be presented as verified")
	}
}

func containsIgnoreCase(s, sub string) bool {
	ls := ""
	for _, c := range s {
		if c >= 'A' && c <= 'Z' {
			ls += string(c + 32)
		} else {
			ls += string(c)
		}
	}
	lsub := ""
	for _, c := range sub {
		if c >= 'A' && c <= 'Z' {
			lsub += string(c + 32)
		} else {
			lsub += string(c)
		}
	}
	// simple contains
	for i := 0; i+len(lsub) <= len(ls); i++ {
		if ls[i:i+len(lsub)] == lsub {
			return true
		}
	}
	return false
}
