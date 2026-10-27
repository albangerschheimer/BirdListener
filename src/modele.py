"""Le classifieur BirdListener, posé sur les empreintes BirdNET."""
import torch
import torch.nn as nn


class Classifieur(nn.Module):
    def __init__(self, n_especes, cache=1024, dropout=0.3):
        super().__init__()
        self.tronc = nn.Sequential(nn.LayerNorm(1024), nn.Linear(1024, cache), nn.GELU(), nn.Dropout(dropout))
        self.especes = nn.Linear(cache, n_especes)
        self.chant = nn.Linear(cache, 1)

    def forward(self, x, masque):
        """x [B, T, 1024], masque [B, T] → scores enregistrement [B, S], chant [B], scores tranche [B, T, S].

        Le score de l'enregistrement est une moyenne « douce » des tranches (log-sum-exp), qui
        privilégie les tranches où l'oiseau s'entend le mieux.
        """
        h = self.tronc(x)
        s = self.especes(h)
        s_masque = s.masked_fill(~masque[..., None], -1e4)
        n = masque.sum(1, keepdim=True).clamp(min=1)
        enr = torch.logsumexp(s_masque, dim=1) - torch.log(n.float())
        c = (self.chant(h).squeeze(-1) * masque).sum(1) / n.squeeze(1)
        return enr, c, s
