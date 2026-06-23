'use client';

import { Button, ModalProps, Text } from '@mantine/core';
import {
    ProgressBanner,
    ProgressModal,
    type ProgressItem,
    type ProgressItemStatus,
} from '@/components/ProgressModal';
import { type ManagerId } from '@/components/managers';

type FileProgress = {
    received: number;
    total?: number;
    status: string;
};

type Props = {
    files: File[];
    perFile: Record<number, FileProgress>;
    status: 'idle' | 'running' | 'done' | 'error';
    jobId: string | null;
    accent?: ManagerId;
} & ModalProps;

function mapStatus(s?: string): ProgressItemStatus {
    switch (s) {
        case 'uploaded':
        case 'published':
            return 'done';
        case 'uploading':
        case 'publishing':
            return 'running';
        case 'error':
            return 'error';
        default:
            return 'waiting';
    }
}

function mb(n: number) {
    return `${(n / 1_000_000).toFixed(1)} MB`;
}

export function PackageUploadModal({ files, perFile, status, jobId, onClose, accent = 'npm', ...props }: Props) {
    const items: ProgressItem[] = files.map((file, idx) => {
        const info = perFile[idx];
        const total = info?.total ?? file.size;
        const received = info?.received ?? 0;
        const st = mapStatus(info?.status);
        const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
        const meta =
            st === 'done' ? '完了' :
            st === 'waiting' ? '待機' :
            st === 'error' ? 'error' :
            `${percent}%`;
        return {
            key: `${file.name}-${idx}`,
            label: file.name,
            status: st,
            percent,
            meta,
            error: st === 'error' ? 'アップロードに失敗しました' : undefined,
        };
    });

    const doneCount = items.filter((i) => i.status === 'done').length;
    const errorCount = items.filter((i) => i.status === 'error').length;
    const totalSize = files.reduce((a, f) => a + (perFile[files.indexOf(f)]?.total ?? f.size), 0);
    const overall = files.length > 0 ? Math.floor((doneCount / files.length) * 100) : 0;

    const state: 'running' | 'done' | 'error' =
        status === 'done' ? 'done' : (status === 'error' || errorCount > 0) && status !== 'running' ? 'error' : status === 'running' ? 'running' : 'running';

    const banner =
        state === 'done' ? (
            <ProgressBanner tone="success" title={`${doneCount} 件すべて publish しました`} detail={`${files.length} ファイル · ${mb(totalSize)}`} />
        ) : state === 'error' ? (
            <ProgressBanner tone="error" title={`${doneCount} 件完了 · ${errorCount} 件失敗`} detail="失敗した項目は再試行できます。" />
        ) : undefined;

    const footer = (
        <>
            <Text className="af-mono" fz={12.5} c="var(--af-muted)">
                {doneCount} / {files.length} 完了
            </Text>
            <Button variant="default" radius="md" onClick={onClose}>閉じる</Button>
        </>
    );

    return (
        <ProgressModal
            {...props}
            onClose={onClose}
            accent={accent}
            title={state === 'done' ? 'アップロード完了' : state === 'error' ? '一部の項目で失敗' : 'アップロード中'}
            subtitle={jobId ? `job ${jobId}` : `${files.length} ファイル`}
            overallPercent={files.length === 0 ? undefined : overall}
            state={state}
            stats={[
                { value: doneCount, unit: `/${files.length}`, label: '完了', accent: state === 'done' },
                { value: errorCount, label: '失敗' },
                { value: mb(totalSize).replace(' MB', ''), unit: ' MB', label: '合計' },
            ]}
            items={items}
            banner={banner}
            footer={footer}
        />
    );
}
