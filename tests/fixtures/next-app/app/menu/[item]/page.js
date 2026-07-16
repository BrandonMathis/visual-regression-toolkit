export const dynamicParams = false;

// Unicode route generated from a param (avoids filesystem NFC/NFD directory-name issues).
export function generateStaticParams() {
  return [{ item: 'café' }];
}

export async function generateMetadata({ params }) {
  const { item } = await params;
  return { title: `Fixture Menu ${decodeURIComponent(item)}` };
}

export default async function MenuItemPage({ params }) {
  const { item } = await params;
  return (
    <main>
      <h1>Menu: {decodeURIComponent(item)}</h1>
      <p>Statically generated unicode-route page.</p>
    </main>
  );
}
