import { t } from "../../utils/helper";

const METHODS = [
  { value: "aes-256-gcm", label: "aes-256-gcm", group: "AEAD" },
  { value: "aes-128-gcm", label: "aes-128-gcm", group: "AEAD" },
  { value: "chacha20-ietf-poly1305", label: "chacha20-ietf-poly1305", group: "AEAD" },
  { value: "xchacha20-ietf-poly1305", label: "xchacha20-ietf-poly1305", group: "AEAD" },
  { value: "2022-blake3-aes-128-gcm", label: "2022-blake3-aes-128-gcm", group: "2022" },
  { value: "2022-blake3-aes-256-gcm", label: "2022-blake3-aes-256-gcm", group: "2022" },
  { value: "2022-blake3-chacha20-poly1305", label: "2022-blake3-chacha20-poly1305", group: "2022" },
  { value: "none", label: "none", group: t("other") },
];

interface EncryptionSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function EncryptionSelect({ value, onChange }: EncryptionSelectProps) {
  const groups = new Map<string, typeof METHODS>();
  for (const m of METHODS) {
    const list = groups.get(m.group) ?? [];
    list.push(m);
    groups.set(m.group, list);
  }

  return (
    <div className="aurorabox-form-field">
      <label className="aurorabox-form-label">{t("encryption_method")}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="aurorabox-select w-full"
      >
        {Array.from(groups.entries()).map(([group, methods]) => (
          <optgroup key={group} label={group}>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
