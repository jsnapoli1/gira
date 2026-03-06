package github

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is an HTTP client for the GitHub API
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// Issue represents a GitHub issue
type Issue struct {
	ID        int64     `json:"id"`
	Number    int64     `json:"number"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	State     string    `json:"state"`
	Labels    []Label   `json:"labels"`
	Assignees []User    `json:"assignees"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Label represents a GitHub label
type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// User represents a GitHub user
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"login"`
	FullName string `json:"name"`
	Email    string `json:"email"`
	Avatar   string `json:"avatar_url"`
}

// Repository represents a GitHub repository
type Repository struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	FullName string `json:"full_name"`
	Owner    User   `json:"owner"`
}

// NewClient creates a new GitHub API client
func NewClient(token string) *Client {
	return &Client{
		BaseURL: "https://api.github.com",
		Token:   token,
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) doRequest(method, path string) ([]byte, error) {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.Token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, string(body))
	}

	return body, nil
}

func (c *Client) doRequestWithBody(method, path string, reqBody interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s%s", c.BaseURL, path)

	var bodyReader io.Reader
	if reqBody != nil {
		jsonBody, err := json.Marshal(reqBody)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.Token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// GetRepos returns repositories for the authenticated user
func (c *Client) GetRepos() ([]Repository, error) {
	data, err := c.doRequest("GET", "/user/repos?per_page=100")
	if err != nil {
		return nil, err
	}

	var repos []Repository
	if err := json.Unmarshal(data, &repos); err != nil {
		return nil, err
	}

	return repos, nil
}

// GetIssues returns issues for a repository
func (c *Client) GetIssues(owner, repo string) ([]Issue, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues?state=all&per_page=100", owner, repo)
	data, err := c.doRequest("GET", path)
	if err != nil {
		return nil, err
	}

	var issues []Issue
	if err := json.Unmarshal(data, &issues); err != nil {
		return nil, err
	}

	return issues, nil
}

// GetIssue returns a single issue
func (c *Client) GetIssue(owner, repo string, number int64) (*Issue, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number)
	data, err := c.doRequest("GET", path)
	if err != nil {
		return nil, err
	}

	var issue Issue
	if err := json.Unmarshal(data, &issue); err != nil {
		return nil, err
	}

	return &issue, nil
}

// CreateIssue creates a new issue
func (c *Client) CreateIssue(owner, repo, title, body string) (*Issue, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues", owner, repo)
	data, err := c.doRequestWithBody("POST", path, map[string]interface{}{
		"title": title,
		"body":  body,
	})
	if err != nil {
		return nil, err
	}

	var issue Issue
	if err := json.Unmarshal(data, &issue); err != nil {
		return nil, err
	}

	return &issue, nil
}

// UpdateIssue updates an existing issue
func (c *Client) UpdateIssue(owner, repo string, number int64, title, body string) error {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number)
	_, err := c.doRequestWithBody("PATCH", path, map[string]interface{}{
		"title": title,
		"body":  body,
	})
	return err
}

// UpdateIssueState updates the state of an issue (open/closed)
func (c *Client) UpdateIssueState(owner, repo string, number int64, state string) error {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number)
	_, err := c.doRequestWithBody("PATCH", path, map[string]interface{}{
		"state": state,
	})
	return err
}

// GetLabels returns labels for a repository
func (c *Client) GetLabels(owner, repo string) ([]Label, error) {
	path := fmt.Sprintf("/repos/%s/%s/labels", owner, repo)
	data, err := c.doRequest("GET", path)
	if err != nil {
		return nil, err
	}

	var labels []Label
	if err := json.Unmarshal(data, &labels); err != nil {
		return nil, err
	}

	return labels, nil
}
