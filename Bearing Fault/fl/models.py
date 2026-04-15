from __future__ import annotations
import torch
import torch.nn as nn
from config import FLConfig


# ─────────────────────────────────────────────
#  1-D CNN
# ─────────────────────────────────────────────
class CNN1D(nn.Module):
    def __init__(self, num_classes: int = 4, dropout: float = 0.3):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv1d(1, 16, kernel_size=64, stride=2, padding=32),
            nn.BatchNorm1d(16),
            nn.ReLU(inplace=True),
            nn.Conv1d(16, 32, kernel_size=32, stride=2, padding=16),
            nn.BatchNorm1d(32),
            nn.ReLU(inplace=True),
            nn.Conv1d(32, 64, kernel_size=16, stride=2, padding=8),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.Conv1d(64, 128, kernel_size=8, stride=2, padding=4),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool1d(16),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 16, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(256, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 2:
            x = x.unsqueeze(1)
        return self.classifier(self.features(x))


# ─────────────────────────────────────────────
#  1-D ResNet
# ─────────────────────────────────────────────
class BasicBlock1D(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, stride: int = 1):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_ch, out_ch, 3, stride=stride, padding=1, bias=False),
            nn.BatchNorm1d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv1d(out_ch, out_ch, 3, stride=1, padding=1, bias=False),
            nn.BatchNorm1d(out_ch),
        )
        self.skip = nn.Sequential()
        if stride != 1 or in_ch != out_ch:
            self.skip = nn.Sequential(
                nn.Conv1d(in_ch, out_ch, 1, stride=stride, bias=False),
                nn.BatchNorm1d(out_ch),
            )
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.conv(x) + self.skip(x))


class ResNet1D(nn.Module):
    def __init__(self, num_classes: int = 4, dropout: float = 0.3):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(1, 64, kernel_size=7, stride=2, padding=3, bias=False),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=3, stride=2, padding=1),
        )
        self.layer1 = nn.Sequential(BasicBlock1D(64, 64), BasicBlock1D(64, 64))
        self.layer2 = nn.Sequential(BasicBlock1D(64, 128, stride=2), BasicBlock1D(128, 128))
        self.layer3 = nn.Sequential(BasicBlock1D(128, 256, stride=2), BasicBlock1D(256, 256))
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(256, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 2:
            x = x.unsqueeze(1)
        x = self.stem(x)
        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        return self.head(self.pool(x))


# ─────────────────────────────────────────────
#  BiLSTM with CNN front-end
# ─────────────────────────────────────────────
class LSTM1D(nn.Module):
    """CNN front-end (1024→128 steps) → Bidirectional LSTM → classifier."""
    def __init__(self, num_classes: int = 4, dropout: float = 0.3):
        super().__init__()
        # Reduce sequence length: 1024 → ~128 time steps
        self.front_end = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=8, stride=4, padding=2),
            nn.BatchNorm1d(32),
            nn.ReLU(inplace=True),
            nn.Conv1d(32, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
        )
        self.lstm = nn.LSTM(
            input_size=64, hidden_size=128, num_layers=2,
            batch_first=True, bidirectional=True,
            dropout=dropout,
        )
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(256, num_classes),   # 128 hidden × 2 directions
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 2:
            x = x.unsqueeze(1)           # (B, 1, 1024)
        x = self.front_end(x)             # (B, 64, ~128)
        x = x.permute(0, 2, 1)           # (B, T, 64) for LSTM
        out, _ = self.lstm(x)
        return self.classifier(out[:, -1, :])   # last time-step


# ─────────────────────────────────────────────
#  TCN (Temporal Convolutional Network)
# ─────────────────────────────────────────────
class _TCNBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, kernel_size: int, dilation: int, dropout: float):
        super().__init__()
        pad = (kernel_size - 1) * dilation // 2
        self.block = nn.Sequential(
            nn.Conv1d(in_ch, out_ch, kernel_size, dilation=dilation, padding=pad),
            nn.BatchNorm1d(out_ch),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Conv1d(out_ch, out_ch, kernel_size, dilation=dilation, padding=pad),
            nn.BatchNorm1d(out_ch),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.downsample = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()
        self.act = nn.GELU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.block(x) + self.downsample(x))


class TCN(nn.Module):
    """Temporal Convolutional Network with exponentially growing dilations (1, 2, 4, 8)."""
    def __init__(self, num_classes: int = 4, dropout: float = 0.3):
        super().__init__()
        channels    = [32, 64, 128, 128]
        kernel_size = 5
        in_ch = 1
        layers = []
        for i, out_ch in enumerate(channels):
            layers.append(_TCNBlock(in_ch, out_ch, kernel_size, dilation=2 ** i, dropout=dropout))
            in_ch = out_ch
        self.network = nn.Sequential(*layers)
        self.pool    = nn.AdaptiveAvgPool1d(1)
        self.head    = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 2:
            x = x.unsqueeze(1)
        return self.head(self.pool(self.network(x)))


# ─────────────────────────────────────────────
#  Factory + weight helpers
# ─────────────────────────────────────────────
def build_model(config: FLConfig, device: torch.device) -> nn.Module:
    if config.model_type == "cnn1d":
        model = CNN1D(dropout=config.dropout)
    elif config.model_type == "resnet1d":
        model = ResNet1D(dropout=config.dropout)
    elif config.model_type == "lstm1d":
        model = LSTM1D(dropout=config.dropout)
    else:  # tcn
        model = TCN(dropout=config.dropout)
    return model.to(device)


def get_model_weights(model: nn.Module) -> dict:
    return {k: v.cpu().clone() for k, v in model.state_dict().items()}


def set_model_weights(model: nn.Module, weights: dict) -> None:
    model.load_state_dict(weights, strict=True)
