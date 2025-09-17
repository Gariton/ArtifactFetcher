import { RequestLogTable } from '@/components/Admin/RequestLogTable';
import { getRequestLogs } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
    const logs = getRequestLogs();
    return (
        <RequestLogTable logs={logs} />
    );
}
