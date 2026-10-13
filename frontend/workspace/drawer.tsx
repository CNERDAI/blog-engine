import React, { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
    onClose();
  };
  useEffect(() => {
    const element = dialog.current!;
    trigger.current = document.activeElement as HTMLElement;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cnerd-drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          onClick={close}
          aria-label={"Close " + title.toLowerCase()}
        >
          Close
        </button>
      </header>
      <div className="cnerd-drawer-body">{children}</div>
    </dialog>
  );
}
