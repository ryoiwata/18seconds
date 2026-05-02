interface TextBodyProps {
	text: string
}

function TextBody(props: TextBodyProps) {
	return (
		<p className="whitespace-pre-wrap font-serif text-base text-foreground leading-relaxed">
			{props.text}
		</p>
	)
}

export type { TextBodyProps }
export { TextBody }
