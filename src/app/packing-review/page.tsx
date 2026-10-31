import { IdentityReview } from '../../components/identity/IdentityReview';
import { importIdentifiedItems } from '../../lib/pipeline/identity-ledger';

export const dynamic = 'force-dynamic';
export default function PackingReviewPage() {
  const ledger = importIdentifiedItems([
    { id: 'item-review-shirts', label: 'shirt', count: 8, attributes: {}, flags: [], placement_tag: 'no-matching-rule' },
    { id: 'item-review-pants', label: 'pants', count: 2, attributes: {}, flags: [], placement_tag: 'no-matching-rule' },
    { id: 'item-review-shampoo', label: 'shampoo', count: 2, attributes: {}, flags: ['assumed_full'], placement_tag: 'needs-review' },
  ], 'review-demo');
  return <IdentityReview initialLedger={ledger} />;
}
