export const CUSTOMER_TYPES = [
  { value: "new", label: "新客戶" },
  { value: "existing", label: "現有客戶" },
] as const;
export type CustomerType = "" | (typeof CUSTOMER_TYPES)[number]["value"];
export const isCustomerType = (value: unknown): value is CustomerType => value === "" || CUSTOMER_TYPES.some((type) => type.value === value);
export const customerTypeLabel = (value: unknown) => CUSTOMER_TYPES.find((type) => type.value === value)?.label ?? "未分類";
export function matchesCustomerType(value: unknown, filter: string | undefined) {
  if (filter === "new" || filter === "existing") return value === filter;
  if (filter === "unclassified") return !value;
  return true;
}
