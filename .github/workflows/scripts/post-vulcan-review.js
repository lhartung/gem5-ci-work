import fs from 'fs';


// Template: pull request review, positive for vagueness
const vagueReport = (response) => `# Vulcan Pull Request Review

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

Code consistency could not be evaluated because the commit message was too vague. A review of the individual commits will be conducted.`;


// Template: pull request review, negative for vagueness
const nonvagueReport = (response) => `# Vulcan Pull Request Review

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}

${response.contradicting.concerning || response.incomplete.concerning ? "The pull request should be reviewed carefully for the reasons identified above." : "The pull request passes all code consistency checks. The changes should still be reviewed for desirability."}`;


// Template: pull request review, error parsing model output
const parseErrorReport = (response) => `# Vulcan Pull Request Review

${response}

Note: an error occurred while parsing the report. A review of the individual commits will be conducted.`;


// Template: commit review, positive for vagueness
const vagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}`;


// Template: commit review, negative for vagueness
const nonvagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}`;


// Template: commit review, error parsing model output
const parseErrorReportCommit = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


// Parse JSON output from model
function parseModelOutput(response) {
  // Strip extraneous text before and after the JSON output.
  var start = response.indexOf("{");
  var end = response.lastIndexOf("}");
  response = response.slice(start, end+1);
  return JSON.parse(response);
}


// Split commit message into subject line and body
function splitCommitMessage(message) {
  const index = message.indexOf("\n");
  if (index < 0) {
    return { subject: message, body: "" };
  } else {
    const subject = message.substring(0, index).trim();
    const body = message.substring(index+1).trim();
    return { subject, body };
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
    const response = parseModelOutput(geminiOutput);
    if (response.vagueness.concerning) {
      comment = vagueReport(response);
    } else {
      comment = nonvagueReport(response);
    }
    core.setOutput("should-review-commits", response.vagueness.concerning);
  } catch (error) {
    console.warn(error);
    comment = parseErrorReport(geminiOutput);
    core.setOutput("should-review-commits", true);
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
    const output = fs.readFileSync(`vulcan-review-${hash}.txt`, 'utf8');

    var vagueness = "-";
    var contradicting = "-";
    var incomplete = "-";

    const url = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${issueNumber}/changes/${hash}`

    const message = splitCommitMessage(commit.commit.message);

    try {
      const response = parseModelOutput(output);
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

    table += `| ${index} | ${message.subject} [${hash}](${url}) | ${vagueness} | ${contradicting} | ${incomplete} |\n`;
    index++;
  }

  const comment = `# Vulcan Commit Review\n\n${table}\n\n${details}`;

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}
