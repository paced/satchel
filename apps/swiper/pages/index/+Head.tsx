const description = "...";

export default function Head() {
  return (
    <>
      <meta name="description" content={description} />
      <meta property="og:description" content={description} />
      <meta name="twitter:description" content={description} />

      <meta property="og:image" content="/img/profile.png" />
      <meta name="twitter:image" content="/img/profile.png" />
      <meta property="og:image:alt" content="..." />

      <meta name="twitter:card" content="summary_large_image" />
    </>
  );
}
