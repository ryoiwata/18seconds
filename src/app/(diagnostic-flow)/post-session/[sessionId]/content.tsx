"use client"

// /post-session/[sessionId] content — consumes the loadSession promise
// from page.tsx and renders <PostSessionShell>.
//
// The shell handles the pacing-line + onboarding-targets form layout;
// keeping the route's content.tsx thin keeps the visual primitive
// reusable from a Phase 5 drill post-session route if Phase 5 chooses
// to share it.

import * as React from "react"
import type { SessionInfo } from "@/app/(diagnostic-flow)/post-session/[sessionId]/page"
import { PostSessionShell } from "@/components/post-session/post-session-shell"

interface PostSessionContentProps {
	sessionPromise: Promise<SessionInfo>
}

function PostSessionContent(props: PostSessionContentProps) {
	const info = React.use(props.sessionPromise)
	return <PostSessionShell pacingMinutes={info.pacingMinutes} />
}

export { PostSessionContent }
