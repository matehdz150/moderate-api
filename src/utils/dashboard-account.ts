export function getDashboardAccountId(userId: string) {
  return `acc_${userId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}
