// ABOUTME: Pure data builder for ask_user tool result details
// ABOUTME: Extracts structured AskUserDetails from tool execution outcomes

export interface AskUserDetails {
	mode: string;
	question: string;
	answer?: string;
	cancelled?: boolean;
	selectedMarkdown?: string;
}

interface BuildInput {
	mode: string;
	question: string;
	answer?: string;
	cancelled?: boolean;
	selectedMarkdown?: string;
}

/** Build a clean AskUserDetails object, omitting undefined fields. */
export function buildAskUserDetails(input: BuildInput): AskUserDetails {
	const details: AskUserDetails = {
		mode: input.mode,
		question: input.question,
	};
	if (input.answer !== undefined) details.answer = input.answer;
	if (input.cancelled) details.cancelled = true;
	if (input.selectedMarkdown !== undefined) details.selectedMarkdown = input.selectedMarkdown;
	return details;
}
