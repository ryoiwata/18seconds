interface TextBodyProps {
	text: string
}

function TextBody(props: TextBodyProps) {
	return (
		<p className="whitespace-pre-wrap text-foreground text-lg leading-relaxed">
			{props.text}
		</p>
	)
}

export type { TextBodyProps }
export { TextBody }
