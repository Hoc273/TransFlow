export type CreditTransactionType =
  | 'INITIAL_GRANT'
  | 'PACKAGE_PURCHASE'
  | 'AI_USAGE'
  | 'ADJUSTMENT'

export type CreditBalance = {
  balance: number
}

export type CreditTransaction = {
  id: string
  userId: string
  amount: number
  balanceAfter: number
  type: CreditTransactionType
  performedByUserId: string | null
  refType: string | null
  refId: string | null
  createdAt: string
}

export type CreditPackage = {
  id: string
  name: string
  creditAmount: number
  priceAmount: number
  priceCurrency: string
  isActive: boolean
  createdAt: string
}

/** Credit is added only once a Super Admin approves the purchase (no payment gateway yet). */
export type CreditPurchaseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'LEGACY_UNVERIFIED'

export type CreditPurchase = {
  purchaseId: string
  userId: string
  packageId: string
  packageName: string | null
  creditAmount: number
  pricePaid: number
  priceCurrency: string | null
  paymentReference: string
  status: CreditPurchaseStatus
  purchasedAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

export type CreditPurchasePage = {
  items: CreditPurchase[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type CreditTransactionPage = {
  items: CreditTransaction[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type CreditTransactionQuery = {
  type?: CreditTransactionType
  from?: string
  to?: string
  page?: number
  size?: number
}
