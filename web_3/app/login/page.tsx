export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <form
        action="/api/auth/login"
        method="POST"
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Drifter 2077 — Dashboard</h1>
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          Password
          <input
            type="password"
            name="password"
            autoFocus
            required
            className="rounded border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        {error && <p className="text-sm text-red-600">Wrong password. Please try again.</p>}
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Login
        </button>
      </form>
    </div>
  );
}
