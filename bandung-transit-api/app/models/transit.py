from datetime import datetime, timezone
from typing import Any
from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base

class Corridor(Base):
    __tablename__ = "corridors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(128))
    toward: Mapped[str | None] = mapped_column(String(128), nullable=True)
    operating_hours: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color: Mapped[str] = mapped_column(String(16), default="#2563eb")
    geom: Mapped[Any] = mapped_column(Geometry(geometry_type="LINESTRING", srid=4326))

    stops: Mapped[list["Stop"]] = relationship("Stop", back_populates="corridor")

class Stop(Base):
    __tablename__ = "stops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    corridor_id: Mapped[int] = mapped_column(ForeignKey("corridors.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(32), default="Shelter")
    sequence: Mapped[int] = mapped_column(Integer)
    geom: Mapped[Any] = mapped_column(Geometry(geometry_type="POINT", srid=4326))

    corridor: Mapped["Corridor"] = relationship("Corridor", back_populates="stops")

class TransferEdge(Base):
    __tablename__ = "transfer_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_stop_id: Mapped[int] = mapped_column(ForeignKey("stops.id"), index=True)
    to_stop_id: Mapped[int] = mapped_column(ForeignKey("stops.id"), index=True)
    walk_meter: Mapped[float] = mapped_column(Float)
    walk_seconds: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("from_stop_id", "to_stop_id", name="uq_transfer_pair"),
    )

class LiveBus(Base):
    __tablename__ = "live_buses"

    bus_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    corridor_id: Mapped[int] = mapped_column(ForeignKey("corridors.id"), index=True)
    bus_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    plate_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    bearing: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    geom: Mapped[Any] = mapped_column(Geometry(geometry_type="POINT", srid=4326))
