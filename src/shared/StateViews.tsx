export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <p className="text-dimmed">{message}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <p className="max-w-lg text-center text-red-400">{message}</p>
    </div>
  );
}
