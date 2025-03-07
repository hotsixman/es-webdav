export type Permission = "read" | "write" | "lock";
export type ResourcePermissionObject = {
    path: string;
    userPermission: Record<Permission, Set<string>>;
    groupPermission: Record<Permission, Set<string>>;
}
export interface PermissionInterface{
    
}