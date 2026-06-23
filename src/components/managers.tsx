import {
    IconBrandDocker,
    IconBrandNpm,
    IconBrandPython,
    IconBox,
    IconBrain,
    type TablerIcon,
} from "@tabler/icons-react";

export type ManagerId = "docker" | "npm" | "pip" | "rpm" | "hf";

export type Manager = {
    id: ManagerId;
    /** Mantine theme color key + CSS accent var suffix */
    color: ManagerId;
    label: string;
    /** short code shown inside the accent tile */
    code: string;
    href: string;
    Icon: TablerIcon;
    blurb: string;
    tags: string[];
};

export const MANAGERS: Manager[] = [
    {
        id: "docker",
        color: "docker",
        label: "Docker",
        code: "DKR",
        href: "/docker",
        Icon: IconBrandDocker,
        blurb: "イメージを依存ごと pull → docker load 可能な tar に。push も対応。",
        tags: ["pull", "push"],
    },
    {
        id: "npm",
        color: "npm",
        label: "npm",
        code: "NPM",
        href: "/npm",
        Icon: IconBrandNpm,
        blurb: "lockfile / name@semver から依存を全解決し全 tarball を取得。",
        tags: ["lockfile", "publish"],
    },
    {
        id: "pip",
        color: "pip",
        label: "pip",
        code: "PIP",
        href: "/pip",
        Icon: IconBrandPython,
        blurb: "PyPI / 社内インデックスから依存込みでまとめて取得・アップロード。",
        tags: ["requirements", "upload"],
    },
    {
        id: "rpm",
        color: "rpm",
        label: "rpm",
        code: "RPM",
        href: "/rpm",
        Icon: IconBox,
        blurb: "公式リポジトリ / EPEL から依存込みで収集。任意の RPM リポジトリへ。",
        tags: ["deps", "EPEL"],
    },
    {
        id: "hf",
        color: "hf",
        label: "Hugging Face",
        code: "HF",
        href: "/hf",
        Icon: IconBrain,
        blurb: "GGUF 等の必要ファイルだけ選択取得し、Ollama 等で使えるアーカイブに。",
        tags: ["gguf", "select"],
    },
];

export const MANAGERS_BY_ID: Record<ManagerId, Manager> = Object.fromEntries(
    MANAGERS.map((m) => [m.id, m]),
) as Record<ManagerId, Manager>;
