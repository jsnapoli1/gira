package gitea

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClient(t *testing.T) {
	client := NewClient("https://gitea.example.com", "test-api-key", false)
	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.BaseURL != "https://gitea.example.com" {
		t.Errorf("client.BaseURL = %q, want %q", client.BaseURL, "https://gitea.example.com")
	}
	if client.APIKey != "test-api-key" {
		t.Errorf("client.APIKey = %q, want %q", client.APIKey, "test-api-key")
	}
	if client.HTTP == nil {
		t.Error("client.HTTP should not be nil")
	}
}

func TestNewClient_WithInsecureTLS(t *testing.T) {
	client := NewClient("https://gitea.example.com", "test-api-key", true)
	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.HTTP.Transport == nil {
		t.Error("client.HTTP.Transport should not be nil")
	}
}

func TestGetRepos(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/user/repos" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "token test-api-key" {
			t.Errorf("unexpected authorization header: %s", r.Header.Get("Authorization"))
		}

		repos := []Repository{
			{ID: 1, Name: "repo1", FullName: "owner/repo1"},
			{ID: 2, Name: "repo2", FullName: "owner/repo2"},
		}
		json.NewEncoder(w).Encode(repos)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	repos, err := client.GetRepos()
	if err != nil {
		t.Fatalf("GetRepos() error = %v", err)
	}
	if len(repos) != 2 {
		t.Errorf("len(repos) = %d, want 2", len(repos))
	}
}

func TestGetIssues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/owner/repo/issues" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		issues := []Issue{
			{ID: 1, Number: 1, Title: "Issue 1", State: "open"},
			{ID: 2, Number: 2, Title: "Issue 2", State: "closed"},
		}
		json.NewEncoder(w).Encode(issues)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	issues, err := client.GetIssues("owner", "repo")
	if err != nil {
		t.Fatalf("GetIssues() error = %v", err)
	}
	if len(issues) != 2 {
		t.Errorf("len(issues) = %d, want 2", len(issues))
	}
}

func TestGetIssue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/owner/repo/issues/1" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		issue := Issue{ID: 1, Number: 1, Title: "Test Issue", State: "open"}
		json.NewEncoder(w).Encode(issue)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	issue, err := client.GetIssue("owner", "repo", 1)
	if err != nil {
		t.Fatalf("GetIssue() error = %v", err)
	}
	if issue.Title != "Test Issue" {
		t.Errorf("issue.Title = %q, want %q", issue.Title, "Test Issue")
	}
}

func TestCreateIssue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/api/v1/repos/owner/repo/issues" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		issue := Issue{ID: 1, Number: 1, Title: "New Issue", Body: "Description", State: "open"}
		json.NewEncoder(w).Encode(issue)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	issue, err := client.CreateIssue("owner", "repo", "New Issue", "Description")
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}
	if issue.Title != "New Issue" {
		t.Errorf("issue.Title = %q, want %q", issue.Title, "New Issue")
	}
}

func TestUpdateIssue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PATCH" {
			t.Errorf("unexpected method: %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	err := client.UpdateIssue("owner", "repo", 1, "Updated Title", "Updated Body")
	if err != nil {
		t.Fatalf("UpdateIssue() error = %v", err)
	}
}

func TestUpdateIssueState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PATCH" {
			t.Errorf("unexpected method: %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	err := client.UpdateIssueState("owner", "repo", 1, "closed")
	if err != nil {
		t.Fatalf("UpdateIssueState() error = %v", err)
	}
}

func TestGetLabels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/owner/repo/labels" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		labels := []Label{
			{ID: 1, Name: "bug", Color: "ff0000"},
			{ID: 2, Name: "feature", Color: "00ff00"},
		}
		json.NewEncoder(w).Encode(labels)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	labels, err := client.GetLabels("owner", "repo")
	if err != nil {
		t.Fatalf("GetLabels() error = %v", err)
	}
	if len(labels) != 2 {
		t.Errorf("len(labels) = %d, want 2", len(labels))
	}
}

func TestGetMilestones(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/owner/repo/milestones" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		milestones := []Milestone{
			{ID: 1, Title: "v1.0", State: "open"},
			{ID: 2, Title: "v2.0", State: "closed"},
		}
		json.NewEncoder(w).Encode(milestones)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	milestones, err := client.GetMilestones("owner", "repo")
	if err != nil {
		t.Fatalf("GetMilestones() error = %v", err)
	}
	if len(milestones) != 2 {
		t.Errorf("len(milestones) = %d, want 2", len(milestones))
	}
}

func TestGetIssueComments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/owner/repo/issues/1/comments" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		comments := []Comment{
			{ID: 1, Body: "Comment 1"},
			{ID: 2, Body: "Comment 2"},
		}
		json.NewEncoder(w).Encode(comments)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	comments, err := client.GetIssueComments("owner", "repo", 1)
	if err != nil {
		t.Fatalf("GetIssueComments() error = %v", err)
	}
	if len(comments) != 2 {
		t.Errorf("len(comments) = %d, want 2", len(comments))
	}
}

func TestCreateIssueComment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/api/v1/repos/owner/repo/issues/1/comments" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		comment := Comment{ID: 1, Body: "New Comment"}
		json.NewEncoder(w).Encode(comment)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	comment, err := client.CreateIssueComment("owner", "repo", 1, "New Comment")
	if err != nil {
		t.Fatalf("CreateIssueComment() error = %v", err)
	}
	if comment.Body != "New Comment" {
		t.Errorf("comment.Body = %q, want %q", comment.Body, "New Comment")
	}
}

func TestTestConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos/search" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("[]"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	err := client.TestConnection()
	if err != nil {
		t.Fatalf("TestConnection() error = %v", err)
	}
}

func TestDoRequest_ErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("unauthorized"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.GetRepos()
	if err == nil {
		t.Error("GetRepos() should return error for 401 response")
	}
}

func TestGetIssues_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.GetIssues("owner", "repo")
	if err == nil {
		t.Error("GetIssues() should return error for invalid JSON")
	}
}

func TestGetLabels_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.GetLabels("owner", "repo")
	if err == nil {
		t.Error("GetLabels() should return error for invalid JSON")
	}
}

func TestGetMilestones_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.GetMilestones("owner", "repo")
	if err == nil {
		t.Error("GetMilestones() should return error for invalid JSON")
	}
}

func TestGetIssueComments_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.GetIssueComments("owner", "repo", 1)
	if err == nil {
		t.Error("GetIssueComments() should return error for invalid JSON")
	}
}

func TestCreateIssueComment_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("invalid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-api-key", false)
	_, err := client.CreateIssueComment("owner", "repo", 1, "body")
	if err == nil {
		t.Error("CreateIssueComment() should return error for invalid JSON")
	}
}
