/* Boundary Book — GitHub-backed shared contest storage.
   Reads via raw.githubusercontent.com (public, no auth).
   Writes via GitHub Contents API (requires a PAT in Settings). */

const GithubStore = (() => {
  const OWNER  = "atharvgaur1845";
  const REPO   = "Boundary_book";
  const BRANCH = "main";
  const DIR    = "data/contests";

  function token() {
    return Store.getSettings().githubToken || "";
  }

  function contestPath(id) {
    return `${DIR}/${id}.json`;
  }

  function shareUrl(id) {
    return location.href.split("#")[0] + "#/join/" + id;
  }

  async function read(contestId) {
    const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${contestPath(contestId)}?_=${Date.now()}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Read failed: ${res.status}`);
    return res.json();
  }

  async function write(data) {
    const tok = token();
    if (!tok) throw new Error("No GitHub token — set it in Settings → Shared Contests.");

    const path = contestPath(data.id);
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
    const headers = {
      Authorization: `token ${tok}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };

    // Fetch current SHA (required by GitHub API for updates)
    let sha;
    const check = await fetch(apiUrl, { headers });
    if (check.ok) {
      sha = (await check.json()).sha;
    } else if (check.status !== 404) {
      throw new Error(`GitHub API error: ${check.status}`);
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const res = await fetch(apiUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `contest: update ${data.id}`,
        content,
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409) throw new Error("Conflict — someone else joined at the same time. Please retry.");
      throw new Error(err.message || `Write failed: ${res.status}`);
    }

    return data;
  }

  return { read, write, shareUrl, contestPath };
})();
