export default function Placeholder({ title, next }: { title: string; next: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <div className="card">
        <p className="muted">Coming next: {next}</p>
      </div>
    </div>
  )
}
