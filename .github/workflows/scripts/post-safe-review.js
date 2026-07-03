const vagueReport = (response) => `🤖 **Safe Review Output:**

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

Code consistency could not be evaluated because the commit message was too vague. The pull request should be reviewed extra carefully for this reason.`;


const nonvagueReport = (response) => `🤖 **Safe Review Output:**

1. **Vagueness:** ${response.vagueness.concerning ? "concerning" : "OK"}

   ${response.vagueness.reason}

2. **Contradicting:** ${response.contradicting.concerning ? "concerning" : "OK"}

   ${response.contradicting.reason}

3. **Incomplete:** ${response.incomplete.concerning ? "concerning" : "OK"}

   ${response.incomplete.reason}

${response.contradicting.concerning || response.incomplete.concerning ? "The pull request should be reviewed carefully for the reasons identified above." : "The pull request passes all code consistency checks."}`;


const parseErrorReport = (response) => `🤖 **Safe Review Output:**

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


function postSafeReview(github, context, core) {
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
    var response = geminiOutput;

    // Gemini is probably trained on a lot of markdown, so it often includes code block signals.
    if (response.startsWith("```json"))
      response = response.slice(7);

    response = response.trimEnd();
    if (response.endsWith("```"))
      response = response.slice(0, -3);

    response = JSON.parse(response);
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

module.exports = postSafeReview;
