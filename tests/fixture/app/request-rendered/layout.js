import { cookies } from 'next/headers';

export default async function RequestRenderedLayout({ children }) {
  await cookies();
  return children;
}
