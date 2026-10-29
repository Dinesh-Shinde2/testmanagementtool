from fastapi import APIRouter

from app.routes import auth, cases, config, execution, folders, imports, projects, reports, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(config.router)
api_router.include_router(users.router)
api_router.include_router(projects.router)
api_router.include_router(folders.router)
api_router.include_router(cases.router)
api_router.include_router(execution.router)
api_router.include_router(imports.router)
api_router.include_router(reports.router)
