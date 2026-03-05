# gitea/ - Gitea API Client

HTTP client for interacting with Gitea's REST API.

## Client Structure

```go
type Client struct {
    BaseURL string      // Gitea instance URL
    APIKey  string      // API token
    HTTP    *http.Client
}
```

## Data Types

- `Issue` - Gitea issue with labels, assignees, milestone
- `Label` - Issue label with color
- `User` - Gitea user account
- `Milestone` - Issue milestone
- `Comment` - Issue comment
- `Repository` - Gitea repository

## API Methods

| Method | Endpoint |
|--------|----------|
| `GetRepos()` | `/user/repos` |
| `GetIssues(owner, repo)` | `/repos/:owner/:repo/issues` |
| `GetIssue(owner, repo, number)` | `/repos/:owner/:repo/issues/:number` |
| `CreateIssue(...)` | POST `/repos/:owner/:repo/issues` |
| `UpdateIssue(...)` | PATCH `/repos/:owner/:repo/issues/:number` |
| `UpdateIssueState(...)` | PATCH state field |
| `GetLabels(owner, repo)` | `/repos/:owner/:repo/labels` |
| `GetMilestones(owner, repo)` | `/repos/:owner/:repo/milestones` |
| `GetIssueComments(...)` | `/repos/:owner/:repo/issues/:number/comments` |
| `CreateIssueComment(...)` | POST comments |

## Authentication

Uses token-based auth via `Authorization: token <API_KEY>` header.

## Best Practices

- Handle API errors gracefully (4xx, 5xx responses)
- Respect rate limits
- 30 second timeout on all requests
- State mapping: internal states map to Gitea's "open"/"closed"
