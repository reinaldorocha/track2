import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, logAudit } from "@/lib/access-control";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const authRes = await requireAdminApi();
  if (authRes instanceof NextResponse) return authRes;
  const adminUser = authRes.session.user;

  try {
    const resolvedParams = await Promise.resolve(params);
    const workspaceId = resolvedParams.id;

    if (!workspaceId) {
      return NextResponse.json({ error: "ID do workspace obrigatório" }, { status: 400 });
    }

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: true },
    });

    if (!ws) {
      return NextResponse.json({ error: "Workspace não encontrado" }, { status: 404 });
    }

    // Exclusão em cascata de dados associados ao workspace
    await prisma.auditLog.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.syncLog.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.notificationSound.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.notificationPreference.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.device.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.rule.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.tax.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.fee.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.expense.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.webhookEndpoint.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.integration.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.product.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.trackingEvent.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.trackingSession.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.utmLink.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.pixel.deleteMany({ where: { workspaceId } }).catch(() => {});

    // Deletar anúncios e campanhas
    const adAccounts = await prisma.adAccount.findMany({ where: { workspaceId }, select: { id: true } });
    for (const acc of adAccounts) {
      const camps = await prisma.campaign.findMany({ where: { adAccountId: acc.id }, select: { id: true } });
      for (const c of camps) {
        const adSets = await prisma.adSet.findMany({ where: { campaignId: c.id }, select: { id: true } });
        for (const s of adSets) {
          await prisma.ad.deleteMany({ where: { adSetId: s.id } }).catch(() => {});
        }
        await prisma.adSet.deleteMany({ where: { campaignId: c.id } }).catch(() => {});
      }
      await prisma.campaign.deleteMany({ where: { adAccountId: acc.id } }).catch(() => {});
    }
    await prisma.adAccount.deleteMany({ where: { workspaceId } }).catch(() => {});

    await prisma.workspaceMember.deleteMany({ where: { workspaceId } }).catch(() => {});
    await prisma.workspace.delete({ where: { id: workspaceId } });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    await logAudit({
      action: "DELETE_WORKSPACE",
      resource: "workspace",
      resourceId: workspaceId,
      userId: adminUser.id,
      userEmail: adminUser.email || undefined,
      metadata: {
        deletedWorkspaceId: workspaceId,
        deletedWorkspaceName: ws.name,
      },
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      message: "Workspace excluído com sucesso",
    });
  } catch (err: any) {
    console.error("[Admin Workspaces DELETE API] Error:", err);
    return NextResponse.json({ error: "Erro ao excluir workspace" }, { status: 500 });
  }
}
