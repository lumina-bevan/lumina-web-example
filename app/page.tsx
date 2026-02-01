import Link from "next/link";

export default function Home() {
  return (
    <div style={{ padding: "24px", fontFamily: "monospace" }}>
      <h1>PSWAP Partial Fill Test</h1>
      <p style={{ marginTop: "16px" }}>
        <Link
          href="/partial"
          style={{ color: "#3b82f6", textDecoration: "underline" }}
        >
          Go to test page →
        </Link>
        <br />
        <Link
          href="/checker"
          style={{ color: "#3b82f6", textDecoration: "underline" }}
        >
          Go to checker page →
        </Link>
      </p>
    </div>
  );
}
