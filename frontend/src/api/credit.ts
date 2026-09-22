import { apiRequest } from '@/lib/api/client'
import type {
  CreditBalance,
  CreditPackage,
  CreditPurchase,
  CreditTransactionPage,
  CreditTransactionQuery,
} from '@/types/credit'

export function getUserCreditApi() {
  return apiRequest<CreditBalance>('/users/me/credit')
}

export function getCreditTransactionsApi(query: CreditTransactionQuery = {}) {
  const search = new URLSearchParams()
  if (query.type) search.set('type', query.type)
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  if (query.page != null) search.set('page', String(query.page))
  if (query.size != null) search.set('size', String(query.size))
  const qs = search.toString()

  return apiRequest<CreditTransactionPage>(
    `/users/me/credit/transactions${qs ? `?${qs}` : ''}`,
  )
}

export function getCreditPackagesApi() {
  return apiRequest<CreditPackage[]>('/credit/packages')
}

export function purchaseCreditPackageApi(packageId: string, paymentReference: string) {
  return apiRequest<CreditPurchase>(`/credit/packages/${packageId}/purchase`, {
    method: 'POST',
    body: { paymentReference },
  })
}
