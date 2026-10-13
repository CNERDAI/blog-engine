import React, { useLayoutEffect, useRef } from "react";
export function ArticleTitle({
  value,
  onChange,
}: {
  value: string;
  onChange: (title: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current!;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = element.scrollHeight + "px";
    };
    let width = element.parentElement!.getBoundingClientRect().width;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    // Height changes also resize the label; only width changes need reflow.
    observer.observe(element.parentElement!);
    resize();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <label className="cnerd-title">
      Article title
      <textarea
        ref={field}
        aria-label="Article title"
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
        placeholder="Give your article a title"
      />
    </label>
  );
}
