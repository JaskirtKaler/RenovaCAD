package analyze_test

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"renovacad/services/api/internal/analyze"
	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/model"
)

func tinyDataURL(mime, name string) model.AnalyzeImage {
	b64 := base64.StdEncoding.EncodeToString([]byte("fakeimagebytes"))
	return model.AnalyzeImage{Name: name, MimeType: mime, DataURL: "data:" + mime + ";base64," + b64}
}

func TestAnalyze_Valid(t *testing.T) {
	fake := &baseten.Fake{
		Analysis: baseten.RawAnalysis{Kind: "analysis", Description: "Kitchen with cabinets", FollowUpQuestions: []string{"Wall length?"}},
	}
	svc := &analyze.Service{Provider: fake}
	req := model.AnalyzePhotoRequest{Image: tinyDataURL("image/png", "kitchen.png")}
	resp, err := svc.Analyze(context.Background(), req)
	if err != nil {
		t.Fatalf("want ok got %v", err)
	}
	if resp.Kind != "analysis" || resp.Description != "Kitchen with cabinets" {
		t.Fatalf("resp %+v", resp)
	}
}

func TestAnalyze_InvalidMime(t *testing.T) {
	svc := &analyze.Service{Provider: &baseten.Fake{}}
	req := model.AnalyzePhotoRequest{Image: tinyDataURL("image/gif", "k.gif")}
	_, err := svc.Analyze(context.Background(), req)
	if err == nil || err.Code != "invalid_request" {
		t.Fatalf("want invalid_request got %v", err)
	}
	if !strings.Contains(err.Message, "unsupported") {
		t.Fatalf("msg %s", err.Message)
	}
}

func TestAnalyze_TooLarge(t *testing.T) {
	svc := &analyze.Service{Provider: &baseten.Fake{}}
	// Create dataUrl that decodes to >5MB
	largeBytes := make([]byte, 5*1024*1024+1)
	for i := range largeBytes {
		largeBytes[i] = 'a'
	}
	b64 := base64.StdEncoding.EncodeToString(largeBytes)
	img := model.AnalyzeImage{Name: "big.png", MimeType: "image/png", DataURL: "data:image/png;base64," + b64}
	req := model.AnalyzePhotoRequest{Image: img}
	_, err := svc.Analyze(context.Background(), req)
	if err == nil || err.Code != "invalid_request" {
		t.Fatalf("want invalid_request for large, got %v", err)
	}
}

func TestAnalyze_ProviderTimeout(t *testing.T) {
	fake := &baseten.Fake{AnalyzeErr: fmtError("provider timeout: context deadline exceeded")}
	svc := &analyze.Service{Provider: fake}
	req := model.AnalyzePhotoRequest{Image: tinyDataURL("image/jpeg", "k.jpg")}
	_, err := svc.Analyze(context.Background(), req)
	if err == nil || err.Code != "provider_timeout" {
		t.Fatalf("want provider_timeout got %v", err)
	}
}

func TestAnalyze_ProviderError(t *testing.T) {
	fake := &baseten.Fake{AnalyzeErr: fmtError("provider error 500: boom")}
	svc := &analyze.Service{Provider: fake}
	req := model.AnalyzePhotoRequest{Image: tinyDataURL("image/jpeg", "k.jpg")}
	_, err := svc.Analyze(context.Background(), req)
	if err == nil || err.Code != "provider_error" {
		t.Fatalf("want provider_error got %v", err)
	}
}

func fmtError(s string) error { return &strErr{s} }
type strErr struct{ s string }
func (e *strErr) Error() string { return e.s }
