export interface ToastMsg { id: number; text: string; error?: boolean }
export default function Toasts({ items }: { items: ToastMsg[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={"toast" + (t.error ? " error" : "")}>
          <span className={"codicon " + (t.error ? "codicon-error" : "codicon-info")} /> {t.text}
        </div>
      ))}
    </div>
  );
}
