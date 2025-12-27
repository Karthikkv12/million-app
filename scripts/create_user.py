"""Small helper to create a user in the configured database using the app's
hashing and DB configuration. Usage:

  python3 scripts/create_user.py --user demo --password demo123 --pg '<CONN>'

If `--pg` is not provided the script will use the app's configured engine
(via `DATABASE_URL` or the default sqlite file).
"""
import argparse
import os


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--user', required=True)
    p.add_argument('--password', required=True)
    p.add_argument('--pg', required=False, help='Optional Postgres URL to override env')
    args = p.parse_args()

    if args.pg:
        os.environ['DATABASE_URL'] = args.pg

    # Import app code paths
    from database.models import init_db
    init_db()
    from logic.services import create_user

    try:
        uid = create_user(args.user, args.password)
        print(f'Created user {args.user} with id {uid}')
    except Exception as e:
        print('Error creating user:', e)


if __name__ == '__main__':
    main()
