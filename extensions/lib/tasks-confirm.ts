// ABOUTME: Pure logic for deciding whether to confirm before clearing the task list.
// ABOUTME: Only incomplete lists require user confirmation; finished lists clear silently.

type TaskStatus = "idle" | "inprogress" | "done";

interface TaskEntry {
	id: number;
	text: string;
	status: TaskStatus;
}

/** Returns true if the user should be asked before replacing the task list.
 *  A fully-completed list (all tasks done) or empty list does not need confirmation. */
export function shouldConfirmNewList(tasks: TaskEntry[], _listTitle: string | null): boolean {
	if (tasks.length === 0) return false;
	return tasks.some(t => t.status !== "done");
}
