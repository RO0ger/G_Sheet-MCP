class DefaultSlackFormatter {
    formatProcessingComplete(summary) {
        return {
            text: `Meeting ${summary.meetingId} analysis complete`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Meeting Analysis Complete*\n` +
                            `Meeting: ${summary.meetingId}\n` +
                            `Hypotheses: ${summary.totalHypotheses}\n` +
                            `Validations: ${summary.validations}\n` +
                            `Duration: ${(summary.duration / 1000).toFixed(1)}s`
                    }
                }
            ]
        };
    }
    formatProcessingError(meetingId, error) {
        return {
            text: `❌ Meeting ${meetingId} processing failed: ${error}`
        };
    }
}
export const slackFormatter = new DefaultSlackFormatter();
