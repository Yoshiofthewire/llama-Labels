import { useEffect, useState } from "react";
import { getJSON, putJSON } from "../api/client";

type AppConfig = {
  timezone: string;
  logLevel: string;
  scan: { intervalSeconds: number };
  rateLimits: { perMinute: number; perHour: number };
  labels: { allowlist: string[]; keywordMappings: Record<string, string[]> };
  llama: { baseUrl: string; apiKey: string; classifyPath: string };
  notifications: {
    mode: "all" | "keywords" | "none";
    keywords: string[];
  };
};

type LabelsResponse = {
  configured: string[];
  imap: string[];
};

function uniqueLabels(labels: string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)));
}

function collectNotificationKeywordOptions(cfg: AppConfig, labelsData: LabelsResponse): string[] {
  const configured = cfg.labels.allowlist ?? [];
  const mapped = Object.values(cfg.labels.keywordMappings ?? {}).flat();
  const imap = labelsData.imap ?? [];
  const selected = cfg.notifications.keywords ?? [];
  return uniqueLabels([...configured, ...mapped, ...imap, ...selected]);
}

function normalizeConfig(input: unknown): AppConfig {
  const source = (input ?? {}) as Record<string, any>;
  const notifications = source.notifications ?? {};

  return {
    timezone: source.timezone ?? "UTC",
    logLevel: source.logLevel ?? "info",
    scan: { intervalSeconds: source.scan?.intervalSeconds ?? 90 },
    rateLimits: {
      perMinute: source.rateLimits?.perMinute ?? 10,
      perHour: source.rateLimits?.perHour ?? 20
    },
    labels: {
      allowlist: source.labels?.allowlist ?? [],
      keywordMappings: source.labels?.keywordMappings ?? {}
    },
    llama: {
      baseUrl: source.llama?.baseUrl ?? "",
      apiKey: source.llama?.apiKey ?? "",
      classifyPath: source.llama?.classifyPath ?? "/"
    },
    notifications: {
      mode: notifications.mode ?? "none",
      keywords: Array.isArray(notifications.keywords) ? notifications.keywords.map(String) : []
    }
  };
}

export function NotificationsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [availableKeywords, setAvailableKeywords] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [nextConfig, labelsData] = await Promise.all([
          getJSON<unknown>("/api/config"),
          getJSON<LabelsResponse>("/api/labels")
        ]);
        if (cancelled) {
          return;
        }
        const normalized = normalizeConfig(nextConfig);
        setCfg(normalized);
        setAvailableKeywords(collectNotificationKeywordOptions(normalized, labelsData));
      } catch {
        if (!cancelled) {
          setStatus("Failed to load notification settings.");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!cfg) {
      return;
    }

    const next: AppConfig = {
      ...cfg,
      notifications: {
        ...cfg.notifications,
        keywords: uniqueLabels(cfg.notifications.keywords)
      }
    };

    try {
      await putJSON<{ ok: boolean }>("/api/config", next);
      setCfg(next);
      setStatus("Notification settings saved.");
    } catch {
      setStatus("Failed to save notification settings.");
    }
  }

  if (!cfg) {
    return (
      <section className="panel">
        <h2>Notifications</h2>
        <p>{status || "Loading notification settings..."}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Notifications</h2>
      <p>Configure browser push notification preferences.</p>

      <div>
        <div>Notification Mode</div>
        <label>
          <input
            type="radio"
            checked={cfg.notifications.mode === "none"}
            onChange={() => setCfg((prev) => (prev ? { ...prev, notifications: { ...prev.notifications, mode: "none" } } : prev))}
          />
          No email
        </label>
        <label>
          <input
            type="radio"
            checked={cfg.notifications.mode === "all"}
            onChange={() => setCfg((prev) => (prev ? { ...prev, notifications: { ...prev.notifications, mode: "all", keywords: [] } } : prev))}
          />
          All emails
        </label>
        <label>
          <input
            type="radio"
            checked={cfg.notifications.mode === "keywords"}
            onChange={() => setCfg((prev) => (prev ? { ...prev, notifications: { ...prev.notifications, mode: "keywords" } } : prev))}
          />
          IMAP keywords
        </label>
      </div>

      {cfg.notifications.mode === "keywords" ? (
        <div>
          <div>IMAP Keywords</div>
          <button
            type="button"
            onClick={() => setCfg((prev) => (prev ? { ...prev, notifications: { ...prev.notifications, keywords: uniqueLabels(availableKeywords) } } : prev))}
          >
            Select All
          </button>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {availableKeywords.length === 0 ? <p>No IMAP keywords found.</p> : null}
            {availableKeywords.map((keyword) => (
              <label key={keyword}>
                <input
                  type="checkbox"
                  checked={cfg.notifications.keywords.includes(keyword)}
                  onChange={(event) => setCfg((prev) => {
                    if (!prev) return prev;
                    const nextKeywords = event.target.checked
                      ? uniqueLabels([...prev.notifications.keywords, keyword])
                      : prev.notifications.keywords.filter((item) => item !== keyword);
                    return { ...prev, notifications: { ...prev.notifications, keywords: nextKeywords } };
                  })}
                />
                {keyword}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <button type="button" onClick={() => void save()}>Save Notifications</button>
      {status ? <p>{status}</p> : null}
    </section>
  );
}