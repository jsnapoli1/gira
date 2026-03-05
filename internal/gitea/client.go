package gitea

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

type Issue struct {
	ID        int64     `json:"id"`
	Number    int64     `json:"number"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	State     string    `json:"state"`
	Labels    []Label   `json:"labels"`
	Assignees []User    `json:"assignees"`
	Milestone *Milestone `json:"milestone"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"login"`
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Avatar   string `json:"avatar_url"`
}

type Milestone struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	State       string    `json:"state"`
	DueDate     time.Time `json:"due_on"`
}

type Comment struct {
	ID        int64     `json:"id"`
	Body      string    `json:"body"`
	User      User      `json:"user"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Repository struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	FullName string `json:"full_name"`
	Owner    User   `json:"owner"`
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) doRequest(method, path string) ([]byte, error) {
	url := fmt.Sprintf("%s/api/v1%s", c.BaseURL, path)
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("token %s", c.APIKey))
	req.Header.Set("Content-Type", "application/json")

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
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(body))
	}

	return body, nil
}

func (c *Client) GetRepos() ([]Repository, error) {
	data, err := c.doRequest("GET", "/user/repos")
	if err != nil {
		return nil, err
	}

	var repos []Repository
	if err := json.Unmarshal(data, &repos); err != nil {
		return nil, err
	}

	return repos, nil
}

func (c *Client) GetIssues(owner, repo string) ([]Issue, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues", owner, repo)
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

func (c *Client) GetMilestones(owner, repo string) ([]Milestone, error) {
	path := fmt.Sprintf("/repos/%s/%s/milestones", owner, repo)
	data, err := c.doRequest("GET", path)
	if err != nil {
		return nil, err
	}

	var milestones []Milestone
	if err := json.Unmarshal(data, &milestones); err != nil {
		return nil, err
	}

	return milestones, nil
}

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

func (c *Client) UpdateIssue(owner, repo string, number int64, title, body string) error {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number)
	_, err := c.doRequestWithBody("PATCH", path, map[string]interface{}{
		"title": title,
		"body":  body,
	})
	return err
}

func (c *Client) UpdateIssueState(owner, repo string, number int64, state string) error {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d", owner, repo, number)
	// Map internal states to Gitea states
	giteaState := "open"
	if state == "closed" {
		giteaState = "closed"
	}
	_, err := c.doRequestWithBody("PATCH", path, map[string]interface{}{
		"state": giteaState,
	})
	return err
}

func (c *Client) GetIssueComments(owner, repo string, number int64) ([]Comment, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, number)
	data, err := c.doRequest("GET", path)
	if err != nil {
		return nil, err
	}

	var comments []Comment
	if err := json.Unmarshal(data, &comments); err != nil {
		return nil, err
	}

	return comments, nil
}

func (c *Client) CreateIssueComment(owner, repo string, number int64, body string) (*Comment, error) {
	path := fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, number)
	data, err := c.doRequestWithBody("POST", path, map[string]interface{}{
		"body": body,
	})
	if err != nil {
		return nil, err
	}

	var comment Comment
	if err := json.Unmarshal(data, &comment); err != nil {
		return nil, err
	}

	return &comment, nil
}

func (c *Client) doRequestWithBody(method, path string, body interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s/api/v1%s", c.BaseURL, path)

	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("token %s", c.APIKey))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
