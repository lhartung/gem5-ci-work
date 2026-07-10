import fs from 'fs';


// Template - pull request review, flagged for vagueness
const vagueReport = (response) => `# Safe Pull Request Review

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

Code consistency could not be evaluated because the commit message was too vague. The pull request should be reviewed extra carefully for this reason.`;


// Template - pull request review, not flagged for vagueness
const nonvagueReport = (response) => `# Safe Pull Request Review

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}

${response.contradicting.concerning || response.incomplete.concerning ? "The pull request should be reviewed carefully for the reasons identified above." : "The pull request passes all code consistency checks. The changes should still be reviewed for desirability."}`;


// Template - pull request review, error parsing model output
const parseErrorReport = (response) => `# Safe Pull Request Review

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


// Template - commit review, flagged for vagueness
const vagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message[0]}](${url})
${message[1] === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message[1] + "</blockquote>"}

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}`;


// Template - commit review, not flagged for vagueness
const nonvagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message[0]}](${url})
${message[1] === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message[1] + "</blockquote>"}

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}`;


// Template - commit review, error parsing model output
const parseErrorReportCommit = (response, hash, url, message, index) => `
## ${index}. [${message[0]}](${url})
${message[1] === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message[1] + "</blockquote>"}

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


function splitCommitMessage(message) {
  const index = message.indexOf("\n");
  if (index < 0) {
    return [message, ""];
  } else {
    const subject = message.substring(0, index).trim();
    const body = message.substring(index+1).trim();
    return [subject, body];
  }
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

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  const commits = JSON.parse(process.env.COMMITS);
  const commitInfo = commits[commitHash].commit;

  // I had some trouble with the html_url field in the commit info,
  // so it may be more reliable to construct it from known information.
  const url = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${issueNumber}/changes/${commitHash}`

  var comment;
  try {
    const response = parseGeminiOutput(geminiOutput);
    if (response.vagueness.concerning) {
      comment = vagueCommitReport(response, commitHash, url, commitInfo.message);
    } else {
      comment = nonvagueCommitReport(response, commitHash, url, commitInfo.message);
    }
  } catch (error) {
    console.warn(error);
    comment = parseErrorReportCommit(geminiOutput, commitHash, url, commitInfo.message);
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}

export async function postAggregateCommitReview(github, context, core) {
  const issueNumber = context.payload.pull_request
    ? context.payload.pull_request.number
    : context.payload.issue.number;

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  const commits = JSON.parse(process.env.COMMITS);

  var table = "| # | Commit | Vagueness | Contradicting | Incomplete |\n";
  table += "| --- | --- | --- | --- | --- |\n";

  var details = "";

  var index = 1;
  for (const [hash, commit] of Object.entries(commits)) {
    const output = fs.readFileSync(`safe-review-${hash}.txt`, 'utf8');

    var vagueness = "N/A";
    var contradicting = "N/A";
    var incomplete = "N/A";

    const url = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${issueNumber}/changes/${hash}`

    const message = splitCommitMessage(commit.commit.message);

    try {
      const response = parseGeminiOutput(output);
      vagueness = response.vagueness.concerning ? "concerning" : "OK";
      if (response.vagueness.concerning) {
        vagueness = "concerning";

        details += vagueCommitReport(response, hash, url, message, index);
      } else {
        vagueness = "OK";
        contradicting = response.contradicting.concerning ? "concerning" : "OK";
        incomplete = response.incomplete.concerning ? "concerning" : "OK";

        details += nonvagueCommitReport(response, hash, url, message, index);
      }
    } catch (error) {
      console.warn(error);

      details += parseErrorReportCommit(response, hash, url, message, index);
    }

    table += `| ${index} | ${message[0]} [${hash}](${url}) | ${vagueness} | ${contradicting} | ${incomplete} |\n`;
    index++;
  }

  const comment = `# Safe Commit Review\n\n${table}\n\n${details}`;

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}
