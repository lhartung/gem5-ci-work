// Template - pull request review, flagged for vagueness
const vagueReport = (response) => `🤖 **Safe PR Review:**

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

Code consistency could not be evaluated because the commit message was too vague. The pull request should be reviewed extra carefully for this reason.`;


// Template - pull request review, not flagged for vagueness
const nonvagueReport = (response) => `🤖 **Safe PR Review:**

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}

${response.contradicting.concerning || response.incomplete.concerning ? "The pull request should be reviewed carefully for the reasons identified above." : "The pull request passes all code consistency checks."}`;


// Template - pull request review, error parsing model output
const parseErrorReport = (response) => `🤖 **Safe PR Review:**

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


// Template - commit review, flagged for vagueness
const vagueCommitReport = (response, commit_hash, commit) => `🤖 **Safe Commit Review:**

**Commit:** [${commit_hash}](${commit.html_url})

<blockquote>
${commit.message}
</blockquote>

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

Code consistency could not be evaluated because the commit message was too vague. The commit should be reviewed extra carefully for this reason.`;


// Template - commit review, not flagged for vagueness
const nonvagueCommitReport = (response, commit_hash, commit) => `🤖 **Safe Commit Review:**

**Commit:** [${commit_hash}](${commit.html_url})

<blockquote>
${commit.message}
</blockquote>

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}

${response.contradicting.concerning || response.incomplete.concerning ? "The commit should be reviewed carefully for the reasons identified above." : "The commit passes all code consistency checks."}`;


// Template - commit review, error parsing model output
const parseErrorReportCommit = (response, commit_hash, commit) => `🤖 **Safe Commit Review:**

**Commit:** [${commit_hash}](${commit.html_url})

<blockquote>
${commit.message}
</blockquote>

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


function parseGeminiOutput(response) {
  // Gemini is probably trained on a lot of markdown, so it often includes code block signals.
  if (response.startsWith("```json"))
    response = response.slice(7);

  response = response.trimEnd();
  if (response.endsWith("```"))
    response = response.slice(0, -3);

  return JSON.parse(response);
}


export async function postPullRequestReview(github, context, core) {
  const geminiOutput = process.env.GEMINI_OUTPUT;
  const issueNumber = context.payload.pull_request
    ? context.payload.pull_request.number
    : context.payload.issue.number;

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  var comment;
  try {
    const response = parseGeminiOutput(geminiOutput);
    if (response.vagueness.concerning) {
      comment = vagueReport(response);
    } else {
      comment = nonvagueReport(response);
    }
  } catch (error) {
    console.warn(error);
    comment = parseErrorReport(geminiOutput);
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}

export async function postCommitReview(github, context, core) {
  const commitHash = process.env.COMMIT_HASH;
  const geminiOutput = process.env.GEMINI_OUTPUT;
  const issueNumber = context.payload.pull_request
    ? context.payload.pull_request.number
    : context.payload.issue.number;

  const commits = JSON.parse(process.env.COMMITS);
  const commitInfo = commits[commitHash].commit;

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  var comment;
  try {
    const response = parseGeminiOutput(geminiOutput);
    if (response.vagueness.concerning) {
      comment = vagueCommitReport(response, commitHash, commitInfo);
    } else {
      comment = nonvagueCommitReport(response, commitHash, commitInfo);
    }
  } catch (error) {
    console.warn(error);
    comment = parseErrorReportCommit(geminiOutput, commitHash, commitInfo);
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}
