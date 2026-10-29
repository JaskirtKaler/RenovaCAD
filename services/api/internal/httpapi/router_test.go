package httpapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/httpapi"
	"renovacad/services/api/internal/model"
	"renovacad/services/api/internal/proposal"
)

func newTestServer(fake *baseten.Fake, token string) http.Handler {
	svc := &proposal.Service{Provider: fake}
	return httpapi.NewRouter(&httpapi.Server{ProposalService: svc, APIToken: token, Version: "0.1.0"})
}

func sampleBody(instruction string) model.ProposeRequest {
	return model.ProposeRequest{
		Instruction:      instruction,
		SelectedObjectID: "base-01",
		SceneRevision:    1,
		Scene: model.Scene{
			Objects: []model.SceneObject{
				{ID: "base-01", Kind: model.KindBaseCabinet, Name: "Base cabinet", DimensionsMm: model.DimensionsMm{Width: 914.4, Height: 876.3, Depth: 609.6}, RotationDegrees: 0, PositionMm: model.PositionMm{X: -650, Y: 0, Z: -300}},
			},
		},
	}
}

func doPropose(t *testing.T, handler http.Handler, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else {
			_ = json.NewEncoder(&buf).Encode(body)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/ai/propose-edit", &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHealth(t *testing.T) {
	h := newTestServer(&baseten.Fake{}, "")
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("health %d", rec.Code)
	}
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if m["status"] != "ok" || m["service"] != "renovacad-api" {
		t.Fatalf("health body %+v", m)
	}
	body := rec.Body.String()
	if strings.Contains(body, "BASETEN") || strings.Contains(body, "API_KEY") {
		t.Fatalf("health leaked secret")
	}
}

func TestPropose_ValidProposal_Returns200(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "proposal", ObjectID: "base-01", AfterMm: 1066.8, Explanation: "wider"}}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, sampleBody("Make this cabinet 6 inches wider"), nil)
	if rec.Code != 200 {
		t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
	}
	var resp model.ProposalResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Kind != "proposal" || resp.Proposal.AfterMm != 1066.8 {
		t.Fatalf("resp %+v", resp)
	}
	if resp.Proposal.BeforeMm != 914.4 || resp.Proposal.SceneRevision != 1 {
		t.Fatalf("before/revision %+v", resp.Proposal)
	}
}

func TestPropose_VersionedAlias(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "need amount"}}
	svc := &proposal.Service{Provider: fake}
	handler := httpapi.NewRouter(&httpapi.Server{ProposalService: svc, Version: "0.1.0"})
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(sampleBody("Make it bigger"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/propose-edit", &buf)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("versioned alias %d %s", rec.Code, rec.Body.String())
	}
}

func TestPropose_Clarification(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "How much wider?"}}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, sampleBody("Make it bigger"), nil)
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var resp model.ProposalResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Kind != "clarification" {
		t.Fatalf("want clarification got %s", resp.Kind)
	}
}

func TestPropose_InvalidRequest400(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "proposal", ObjectID: "base-01", AfterMm: 1066.8}}
	h := newTestServer(fake, "")
	bad := sampleBody("")
	rec := doPropose(t, h, bad, nil)
	if rec.Code != 400 {
		t.Fatalf("want 400 got %d %s", rec.Code, rec.Body.String())
	}
	var env model.ErrorEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "invalid_request" {
		t.Fatalf("code %s", env.Error.Code)
	}
}

func TestPropose_WrongObjectIDFromProvider502(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "proposal", ObjectID: "other", AfterMm: 1066.8}}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, sampleBody("Make it 6 inches wider"), nil)
	if rec.Code != 502 {
		t.Fatalf("want 502 got %d %s", rec.Code, rec.Body.String())
	}
	var env model.ErrorEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "invalid_provider_response" {
		t.Fatalf("code %s", env.Error.Code)
	}
}

func TestPropose_InvalidDimsOutOfRange502(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "proposal", ObjectID: "base-01", AfterMm: 99999}}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, sampleBody("Make it huge"), nil)
	if rec.Code != 502 {
		t.Fatalf("want 502 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPropose_ProviderError502(t *testing.T) {
	fake := &baseten.Fake{Err: fmt.Errorf("provider error 500: boom")}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, sampleBody("Make it wider"), nil)
	if rec.Code != 502 {
		t.Fatalf("want 502 got %d %s", rec.Code, rec.Body.String())
	}
	var env model.ErrorEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "provider_error" {
		t.Fatalf("code %s body %s", env.Error.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("leaked provider body")
	}
}

func TestPropose_Timeout504(t *testing.T) {
	fake2 := &baseten.Fake{Err: fmt.Errorf("provider timeout: context deadline exceeded")}
	h2 := newTestServer(fake2, "")
	rec := doPropose(t, h2, sampleBody("Make it wider"), nil)
	if rec.Code != 504 {
		t.Fatalf("want 504 got %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuth_RequiredWhenTokenSet(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "?"}}
	h := newTestServer(fake, "secret123")
	rec := doPropose(t, h, sampleBody("hi"), nil)
	if rec.Code != 401 {
		t.Fatalf("want 401 got %d %s", rec.Code, rec.Body.String())
	}
	// Wrong token
	rec = doPropose(t, h, sampleBody("hi"), map[string]string{"Authorization": strings.Join([]string{"Bearer", "wrong"}, " ")})
	if rec.Code != 401 {
		t.Fatalf("want 401 got %d", rec.Code)
	}
	// Correct bearer
	correct := strings.Join([]string{"Bearer", "secret123"}, " ")
	rec = doPropose(t, h, sampleBody("hi"), map[string]string{"Authorization": correct})
	if rec.Code != 200 {
		t.Fatalf("want 200 got %d %s", rec.Code, rec.Body.String())
	}
	// X-RenovaCAD-Token also works
	rec = doPropose(t, h, sampleBody("hi"), map[string]string{"X-RenovaCAD-Token": "secret123"})
	if rec.Code != 200 {
		t.Fatalf("want 200 via X-token got %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("health should be 200 without token, got %d", rec.Code)
	}
}

func TestRequestSizeLimit(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "?"}}
	h := newTestServer(fake, "")
	large := strings.Repeat("x", 300*1024)
	body := fmt.Sprintf(`{"instruction":"%s","selectedObjectId":"base-01","sceneRevision":0,"scene":{"objects":[{"id":"base-01","kind":"base-cabinet","name":"Base cabinet","dimensionsMm":{"width":914.4,"height":876.3,"depth":609.6},"rotationDegrees":0,"positionMm":{"x":0,"y":0,"z":0}}]}}`, large)
	rec := doPropose(t, h, body, nil)
	if rec.Code != 400 {
		t.Fatalf("want 400 for oversize got %d body len %d", rec.Code, rec.Body.Len())
	}
	if !strings.Contains(rec.Body.String(), "too large") {
		t.Fatalf("expected too large message, got %s", rec.Body.String())
	}
}

func TestUnknownField400(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "?"}}
	h := newTestServer(fake, "")
	body := `{"instruction":"hi","selectedObjectId":"base-01","sceneRevision":0,"scene":{"objects":[{"id":"base-01","kind":"base-cabinet","name":"Base cabinet","dimensionsMm":{"width":914.4,"height":876.3,"depth":609.6},"rotationDegrees":0,"positionMm":{"x":0,"y":0,"z":0}}]},"extra":"field"}`
	rec := doPropose(t, h, body, nil)
	if rec.Code != 400 {
		t.Fatalf("want 400 for unknown field, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestMalformedJSON400(t *testing.T) {
	fake := &baseten.Fake{Result: baseten.RawResult{Kind: "clarification", Message: "?"}}
	h := newTestServer(fake, "")
	rec := doPropose(t, h, `{"instruction": `, nil)
	if rec.Code != 400 {
		t.Fatalf("want 400 got %d", rec.Code)
	}
}
