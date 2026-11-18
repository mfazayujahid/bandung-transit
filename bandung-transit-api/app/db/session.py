from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

engine = create_engine(
    settings.normalized_database_url,
    pool_pre_ping=True,   # Automatically recover dropped cloud/Supabase pooler connections
    pool_recycle=300,     # Recycle connections every 5 min before cloud idle timeouts
    pool_size=5,
    max_overflow=10,
)
sessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = sessionLocal()
    try:
        yield db
    finally:
        db.close()
