/** Admin's sections, as plain links: each is its own view of /admin. */
export function AdminNav({ current }: { current: 'orders' | 'usage' | 'feedback' }) {
  const links: [typeof current, string, string][] = [
    ['orders', 'Orders', '/admin/'],
    ['usage', 'Usage', '/admin/?view=usage'],
    ['feedback', 'Feedback', '/admin/?view=feedback'],
  ];
  return (
    <nav className="admin-nav" aria-label="Admin">
      {links.map(([id, label, href]) => (
        <a key={id} href={href} aria-current={id === current ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
