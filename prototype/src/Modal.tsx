import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, className = '', footer, bodyClassName = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string; footer?: ReactNode; bodyClassName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog className={`modal ${className}`} ref={ref} data-ccp-area={title} aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={24}/></button></header>
    {footer ? <><div className={`modal-body ${bodyClassName}`}>{children}</div><footer className="modal-footer">{footer}</footer></> : children}
  </dialog>;
}
