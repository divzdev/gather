/** The landing page's questions, in one place.
 *
 *  Read twice: once to render the two columns, once to emit the FAQPage
 *  structured data. Typing them in both places is how the rich result and the
 *  page drift apart.
 */
export const FAQS = [
  {
    q: "Is this really free?",
    a: "Yes. MIT licensed. There is no paid tier and nothing is held back from the open source version. The code you are reading now runs on your own server, forever.",
  },
  {
    q: "How many proposals can it handle?",
    a: "The demo runs 214 proposals, 80 speakers and 61 sessions, and the agenda holds 60fps while dragging 120 sessions across six rooms. It is Postgres and a schedule, not a distributed system problem.",
  },
  {
    q: "Can my committee review anonymously?",
    a: "Yes. Blind rounds strip names, companies and any answer you flag as identifying, on the server, before the data reaches the reviewer's browser.",
  },
  {
    q: "Do speakers need an account?",
    a: "No. They get a link. They can set a password if they would rather have one, but nobody is asked to remember another login for a conference they speak at once.",
  },
  {
    q: "What happens to my data if I stop using it?",
    a: "It is in your own Postgres database, and everything exports as CSV or XLSX. There is no export fee, because there is nobody to pay.",
  },
  {
    q: "Can I move off my current tool mid-cycle?",
    a: "Import speakers and sessions from CSV, then carry on. Review history is the awkward part of any migration, so switch between events if you can.",
  },
  {
    q: "Does it do registration and ticketing?",
    a: "No, deliberately. That is a different product with different regulations attached. Gather pushes the program to whatever you already use for registration.",
  },
  {
    q: "Who is behind it?",
    a: "It was built to replace a specific forty thousand dollar renewal for a specific conference, and opened up so the next conference does not have to have the same argument.",
  },
] as const;
