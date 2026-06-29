import { Layer } from "@/lib/progressBus";
import { Button, ModalProps, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { memo } from "react";
import {
    ProgressBanner,
    ProgressModal,
    type ProgressItem,
    type ProgressItemStatus,
} from "@/components/ProgressModal";
import { type ManagerId } from "@/components/managers";

type DownloadModalType = {
    repo: string;
    tag: string;
    status: string;
    layers: Layer[];
    perLayer: Record<number, { received: number; total?: number; status: "process"|"done"|"skipped"; }>;
    jobId: string|null;
    accent?: ManagerId;
} & ModalProps;

function shortDigest(d: string) {
    const v = d.includes(":") ? d.split(":").pop()! : d;
    if (v.length <= 11) return v;
    return `${v.slice(0, 6)}…${v.slice(-3)}`;
}

function mb(n: number) {
    return `${(n / 1_000_000).toFixed(0)} MB`;
}

export const DownloadModal = memo(function DownloadModalMemo({
    repo,
    tag,
    status,
    jobId,
    layers,
    perLayer,
    accent = "docker",
    ...props
}: DownloadModalType) {

    const totals = Object.values(perLayer).reduce(
        (acc, v) => { acc.received += v.received || 0; acc.total += v.total || 0; return acc; },
        { received: 0, total: 0 }
    );
    const overallPercent = totals.total > 0 ? Math.floor((totals.received / totals.total) * 100) : (status === "done" ? 100 : 0);

    const doneCount = Object.values(perLayer).filter((v) => v.status === "done" || v.status === "skipped").length;
    const total = layers.length;

    const state: "running" | "done" | "error" = status === "done" ? "done" : status === "error" ? "error" : "running";
    const indeterminate = status === "starting" || status === "running" || layers.length === 0;

    const items: ProgressItem[] = layers.map((layer, i) => {
        const info = perLayer[i];
        const rawStatus = info?.status ?? "process";
        const st: ProgressItemStatus =
            rawStatus === "done" ? "done" :
            rawStatus === "skipped" ? "skipped" :
            (info?.received ?? 0) > 0 ? "running" : "waiting";
        const pct = info?.total ? Math.floor(((info.received || 0) / info.total) * 100) : 0;
        const meta =
            st === "skipped" ? "skip" :
            st === "waiting" ? "待機" :
            info?.total ? mb(info.total) : `${pct}%`;
        return { key: `${i}`, label: shortDigest(layer.digest), status: st, percent: pct, meta };
    });

    const banner = state === "done" ? (
        <ProgressBanner
            tone="success"
            title={`${total} 項目すべて取得しました`}
            detail={`${repo}:${tag} · ${mb(totals.total || totals.received)}`}
        />
    ) : undefined;

    const footer = state === "done" ? (
        <>
            <Button variant="default" radius="md" onClick={() => props.onClose?.()}>閉じる</Button>
            <Button
                color="success"
                radius="md"
                leftSection={<IconDownload size="1rem" />}
                component="a"
                href={`/api/build/download?jobId=${jobId}`}
                target="_blank"
                disabled={jobId == null}
            >
                アーカイブをダウンロード
            </Button>
        </>
    ) : (
        <>
            <Text className="af-mono" fz={12.5} c="var(--af-muted)">
                {indeterminate ? "依存を解決しています…" : `${doneCount} / ${total} layers`}
            </Text>
            <Button variant="default" radius="md" onClick={() => props.onClose?.()}>キャンセル</Button>
        </>
    );

    return (
        <ProgressModal
            {...props}
            accent={accent}
            title={state === "done" ? "取得完了" : state === "error" ? "取得に失敗" : "取得中"}
            subtitle={`${repo}:${tag}`}
            overallPercent={indeterminate ? undefined : overallPercent}
            state={state}
            stats={[
                { value: doneCount, unit: `/${total}`, label: "完了 / 全体", accent: state === "done" },
                { value: mb(totals.received).replace(" MB", ""), unit: " MB", label: "取得サイズ" },
                { value: total, label: "レイヤ数" },
            ]}
            items={items}
            banner={banner}
            footer={footer}
        />
    );
});
