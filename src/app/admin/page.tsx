import { RequestLogTable } from '@/components/Admin/RequestLogTable';
import { getRequestLogs } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
    const logs = getRequestLogs();
    const enabled = process.env.ADMIN_ENABLED;
    return /^(1|true|on|yes)$/i.test(enabled || '') ? (
        <RequestLogTable logs={logs} />
    ) : (
        <>
            admin console is disabled.
        </>
    )
}
