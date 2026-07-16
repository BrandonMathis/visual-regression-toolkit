export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: 'alpha' }, { slug: 'beta' }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return { title: `Fixture Product ${slug}` };
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Product: {slug}</h1>
      <p>Statically generated product page.</p>
    </main>
  );
}
