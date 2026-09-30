import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface SearchItem {
  id: string;
  label: string;
  hint?: string;
}

interface SearchState {
  items: SearchItem[];
  pick: (id: string) => void;
  register: (items: SearchItem[], pick: (id: string) => void) => void;
}

const SearchContext = createContext<SearchState | null>(null);

/** Shares what the active graph can search with the explorer's search box. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SearchItem[]>([]);
  const pickRef = useRef<(id: string) => void>(() => {});

  const register = useCallback(
    (nextItems: SearchItem[], nextPick: (id: string) => void) => {
      pickRef.current = nextPick;
      setItems(nextItems);
    },
    []
  );

  const value = useMemo<SearchState>(
    () => ({
      items,
      pick: (id) => pickRef.current(id),
      register,
    }),
    [items, register]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearch must be used inside a SearchProvider");
  }
  return context;
}

/**
 * Lets a graph publish its searchable items. Cleared on unmount so a graph that
 * is no longer shown leaves nothing behind in the search box.
 */
export function useSearchRegistration(
  items: SearchItem[],
  pick: (id: string) => void
): void {
  const { register } = useSearch();
  useEffect(() => {
    register(items, pick);
    return () => register([], () => {});
  }, [register, items, pick]);
}
